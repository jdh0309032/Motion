/*
 * Motion Runtime — runs inside a Claude-made HTML document.
 *  1. Virtualises the clock (rAF, performance.now, Date.now, timers) so any frame can be rendered exactly.
 *  2. analyze(): converts the page's CSS / WAAPI / GSAP animations into layers + keyframes.
 *  3. Strips those originals and drives the elements from the keyframe project (transform, opacity,
 *     effects, CSS property tracks, parenting, 3D, created layers, comp effects).
 * Shared by the editor preview, exported HTML and the frame-exact renderer. Self-contained, no deps.
 */
(function (G) {
  if (G.MotionRuntime) return;
  const D = G.document;

  // ───────────────────────────── 1. virtual clock ─────────────────────────────
  const real = {
    raf: G.requestAnimationFrame.bind(G), now: G.performance.now.bind(G.performance),
    dateNow: Date.now, setTimeout: G.setTimeout.bind(G), clearTimeout: G.clearTimeout.bind(G),
    setInterval: G.setInterval.bind(G), clearInterval: G.clearInterval.bind(G),
  };
  const clock = { t: 0, epoch: real.dateNow(), rafQ: [], timers: [], tid: 1, rafUsers: 0, rafCount: 0 };
  G.performance.now = () => clock.t;
  Date.now = () => clock.epoch + clock.t;
  G.requestAnimationFrame = (cb) => { clock.rafQ.push(cb); clock.rafCount++; return clock.rafQ.length; };
  G.cancelAnimationFrame = () => {};
  G.setTimeout = (fn, ms = 0, ...a) => { const id = clock.tid++; clock.timers.push({ id, due: clock.t + Math.max(0, +ms || 0), fn, a }); return id; };
  G.setInterval = (fn, ms = 0, ...a) => { const id = clock.tid++; clock.timers.push({ id, due: clock.t + Math.max(1, +ms || 0), fn, a, every: Math.max(1, +ms || 0) }); return id; };
  G.clearTimeout = G.clearInterval = (id) => { clock.timers = clock.timers.filter((x) => x.id !== id); };
  // seeded Math.random → particles/noise are identical on every load (preview, reload, render)
  let seed = 0x9e3779b9;
  Math.random = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

  function runTimers() {
    for (let guard = 0; guard < 1000; guard++) {
      clock.timers.sort((a, b) => a.due - b.due);
      const x = clock.timers[0];
      if (!x || x.due > clock.t) return;
      if (x.every) x.due += x.every; else clock.timers.shift();
      try { typeof x.fn === 'function' ? x.fn(...x.a) : null; } catch (e) { console.error(e); }
    }
  }
  /** Advance virtual time to ms, firing timers and rAF callbacks at frame steps. */
  function advanceTo(ms, step) {
    if (ms < clock.t) return false;
    while (clock.t < ms - 1e-6) {
      clock.t = Math.min(ms, clock.t + step);
      runTimers();
      const q = clock.rafQ; clock.rafQ = [];
      for (const cb of q) { try { cb(clock.t); } catch (e) { console.error(e); } }
    }
    runTimers();
    return true;
  }

  // ───────────────────────────── 2. math ─────────────────────────────
  function cubicBezier(x1, y1, x2, y2) {
    if (x1 === y1 && x2 === y2) return (t) => t;
    const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
    const sx = (t) => ((ax * t + bx) * t + cx) * t, sy = (t) => ((ay * t + by) * t + cy) * t, dx = (t) => (3 * ax * t + 2 * bx) * t + cx;
    return (x) => {
      if (x <= 0) return 0; if (x >= 1) return 1;
      let t = x;
      for (let i = 0; i < 8; i++) { const e = sx(t) - x; if (Math.abs(e) < 1e-7) return sy(t); const d = dx(t); if (Math.abs(d) < 1e-6) break; t -= e / d; }
      let lo = 0, hi = 1; t = x;
      for (let i = 0; i < 40; i++) { const v = sx(t); if (Math.abs(v - x) < 1e-7) break; if (v < x) lo = t; else hi = t; t = (lo + hi) / 2; }
      return sy(t);
    };
  }
  const easeCache = new Map();
  const easeFn = (e) => { const k = e.join(); let f = easeCache.get(k); if (!f) easeCache.set(k, (f = cubicBezier(...e))); return f; };
  const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
  function lerpValue(a, b, p) {
    if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * p;
    const sa = String(a), sb = String(b);
    const na = sa.match(NUM), nb = sb.match(NUM);
    if (!na || !nb || na.length !== nb.length || sa.replace(NUM, '#') !== sb.replace(NUM, '#')) return p < 1 ? a : b;
    let i = 0;
    const isColor = /^rgba?\(/.test(sa);
    return sa.replace(NUM, () => { const v = +na[i] + (nb[i] - na[i]) * p; i++; return isColor && i <= 3 ? Math.round(v) : +v.toFixed(4); });
  }
  /** Value of a keyframe track at time t (seconds). loop: 'cycle' | 'pingpong'. */
  function valueAt(keys, t, loop) {
    const n = keys.length; if (!n) return undefined;
    const t0 = keys[0].t, t1 = keys[n - 1].t;
    if (loop && n > 1 && t > t1) {
      const span = t1 - t0, k = Math.floor((t - t0) / span), r = (t - t0) % span;
      t = loop === 'pingpong' && k % 2 ? t1 - r : t0 + r;
    }
    if (t <= t0) return keys[0].v;
    if (t >= t1) return keys[n - 1].v;
    let i = 0; while (i < n - 2 && keys[i + 1].t <= t) i++;
    const a = keys[i], b = keys[i + 1];
    if (a.hold) return a.v;
    return lerpValue(a.v, b.v, easeFn(a.ease || [0, 0, 1, 1])((t - a.t) / (b.t - a.t || 1)));
  }

  const M = (init) => new DOMMatrix(init);
  const T = (x, y, z = 0) => M().translate(x, y, z);
  function composeLocal(p, c) {
    // T(pos) · Rz · Ry · Rx · S · T(-restCenter)
    return M().translate(p.x, p.y, p.z || 0)
      .rotateAxisAngle(0, 0, 1, p.rotation || 0).rotateAxisAngle(0, 1, 0, p.rotY || 0).rotateAxisAngle(1, 0, 0, p.rotX || 0)
      .scale((p.scale / 100) * ((p.scaleX ?? 100) / 100), (p.scale / 100) * ((p.scaleY ?? 100) / 100), p.scale / 100).translate(-c.x, -c.y, 0);
  }
  /** Decompose stage-space matrix X about rest center c into layer props. */
  function decompose(X, c) {
    const q = X.transformPoint(new DOMPoint(c.x, c.y, 0));
    const sx = Math.hypot(X.m11, X.m12, X.m13), sy0 = Math.hypot(X.m21, X.m22, X.m23);
    const sy = X.m11 * X.m22 - X.m12 * X.m21 < 0 ? -sy0 : sy0;
    const s = sx || 1e-9;
    let rotX = 0, rotY = 0, rotation;
    if (X.is2D) rotation = sx > 1e-9 ? (Math.atan2(X.m12, X.m11) * 180) / Math.PI : sy0 > 1e-9 ? (Math.atan2(-X.m21, X.m22) * 180) / Math.PI : 0;
    else {
      const R20 = X.m13 / s, R21 = X.m23 / s, R22 = X.m33 / s, R10 = X.m12 / s, R00 = X.m11 / s;
      rotY = (Math.asin(Math.max(-1, Math.min(1, -R20))) * 180) / Math.PI;
      rotX = (Math.atan2(R21, R22) * 180) / Math.PI;
      rotation = (Math.atan2(R10, R00) * 180) / Math.PI;
    }
    return { x: q.x, y: q.y, z: q.z, rotation, rotX, rotY, sx: sx * 100, sy: sy * 100 };
  }
  const r4 = (v) => Math.round(v * 1e4) / 1e4;
  /** Fit a cubic-bezier ease to samples (xs ∈ [0,1], ys progress). Nelder–Mead, several starts. */
  function fitBezier(xs, ys, hint) {
    const clamp = (p) => [Math.min(1, Math.max(0, p[0])), p[1], Math.min(1, Math.max(0, p[2])), p[3]];
    const cost = (p) => { const f = cubicBezier(...clamp(p)); let s = 0; for (let i = 0; i < xs.length; i++) { const d = f(xs[i]) - ys[i]; s += d * d; } return s; };
    const nm = (p0) => {
      let S = [p0, ...[0, 1, 2, 3].map((i) => p0.map((v, j) => (j === i ? v + 0.15 : v)))].map((p) => [p, cost(p)]);
      for (let it = 0; it < 300; it++) {
        S.sort((a, b) => a[1] - b[1]);
        if (S[4][1] - S[0][1] < 1e-12) break;
        const c = [0, 1, 2, 3].map((j) => (S[0][0][j] + S[1][0][j] + S[2][0][j] + S[3][0][j]) / 4);
        const at = (k) => c.map((v, j) => v + k * (S[4][0][j] - v));
        const r = at(-1), fr = cost(r);
        if (fr < S[0][1]) { const e = at(-2), fe = cost(e); S[4] = fe < fr ? [e, fe] : [r, fr]; }
        else if (fr < S[3][1]) S[4] = [r, fr];
        else { const k = at(0.5), fk = cost(k); if (fk < S[4][1]) S[4] = [k, fk]; else S = S.map((s, i) => (i ? ((p) => [p, cost(p)])(s[0].map((v, j) => S[0][0][j] + 0.5 * (v - S[0][0][j]))) : s)); }
      }
      S.sort((a, b) => a[1] - b[1]); return S[0];
    };
    let best = null;
    for (const p0 of [hint, [0.33, 0, 0.67, 1], [0.42, 0, 0.58, 1], [0, 0, 1, 1], [0.2, 0.8, 0.2, 1], [0.8, 0, 0.8, 0.2]]) {
      if (!p0) continue; const r = nm([...p0]); if (!best || r[1] < best[1]) best = r;
    }
    const e = clamp(best[0]).map((v) => Math.round(v * 1e4) / 1e4), f = cubicBezier(...e);
    let err = 0; for (let i = 0; i < xs.length; i++) err = Math.max(err, Math.abs(f(xs[i]) - ys[i]));
    return { e, err };
  }

  // ───────────────────────────── 3. selectors & measurement ─────────────────────────────
  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return null;
    const parts = [];
    while (el && el.nodeType === 1 && el !== D.documentElement) {
      if (el.id && D.querySelectorAll('#' + CSS.escape(el.id)).length === 1) { parts.unshift('#' + CSS.escape(el.id)); break; }
      if (el === D.body) { parts.unshift('body'); break; }
      const par = el.parentElement, idx = [...par.children].indexOf(el) + 1;
      parts.unshift(`${el.tagName.toLowerCase()}:nth-child(${idx})`);
      el = par;
    }
    return parts.join(' > ');
  }
  function labelFor(el) {
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24);
    const cls = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return (el.id ? '#' + el.id : el.tagName.toLowerCase() + cls) + (txt && el.children.length < 3 ? ` "${txt}"` : '');
  }
  const isSVG = (el) => el instanceof SVGElement && el.tagName.toLowerCase() !== 'svg';

  /** Measure an element at rest (our transform cleared). Returns static geometry used by render(). */
  function measure(el) {
    const prevT = el.style.transform, prevO = el.style.transformOrigin, prevB = el.style.transformBox;
    el.style.transform = ''; el.style.transformOrigin = ''; if (isSVG(el)) el.style.transformBox = 'fill-box';
    const cs = getComputedStyle(el);
    const B = cs.transform && cs.transform !== 'none' ? M(cs.transform) : M();
    const [ox, oy, oz] = cs.transformOrigin.split(' ').map(parseFloat);
    el.style.transform = 'none';
    const r = el.getBoundingClientRect();
    let w, h;
    if (isSVG(el)) { const bb = el.getBBox(); w = bb.width || 1; h = bb.height || 1; }
    else { w = el.offsetWidth || r.width || 1; h = el.offsetHeight || r.height || 1; }
    const sx = r.width / w || 1, sy = r.height / h || 1;
    const E0 = M().translate(r.left + scrollX, r.top + scrollY).scale(sx, sy);       // local → stage (own transform none)
    const Bo = M().translate(ox, oy, oz || 0).multiply(B).translate(-ox, -oy, -(oz || 0)); // static transform about its origin
    el.style.transform = prevT; el.style.transformOrigin = prevO; el.style.transformBox = prevB;
    // Rest = layout box with NO transform. The page's own static transform becomes the layer's base
    // props (S, stage space), so zero-scale or centring transforms need no inversion.
    const quad = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => E0.transformPoint(new DOMPoint(x, y)));
    const c = { x: (quad[0].x + quad[2].x) / 2, y: (quad[0].y + quad[2].y) / 2 };
    const E0inv = E0.inverse();
    const S = E0.multiply(Bo).multiply(E0inv);
    return { E0, E0inv, S, quad: quad.map((p) => ({ x: p.x, y: p.y })), c, w, h };
  }

  // ───────────────────────────── 4. analysis (import) ─────────────────────────────
  const CSS_EASE = { linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1] };
  function parseCssEase(s) {
    s = (s || 'linear').trim();
    if (CSS_EASE[s]) return CSS_EASE[s];
    const m = s.match(/^cubic-bezier\(([^)]+)\)$/);
    if (m) return m[1].split(',').map(Number);
    if (/^steps|step-start|step-end/.test(s)) return 'hold';
    return null; // linear(...) etc. → bake
  }
  // GSAP eases → cubic-bezier approximations (standard tables). Anything else is baked.
  const GSAP_EASE = {
    none: [0, 0, 1, 1], linear: [0, 0, 1, 1],
    'power1.in': [0.55, 0.085, 0.68, 0.53], 'power1.out': [0.25, 0.46, 0.45, 0.94], 'power1.inOut': [0.455, 0.03, 0.515, 0.955],
    'power2.in': [0.55, 0.055, 0.675, 0.19], 'power2.out': [0.215, 0.61, 0.355, 1], 'power2.inOut': [0.645, 0.045, 0.355, 1],
    'power3.in': [0.895, 0.03, 0.685, 0.22], 'power3.out': [0.165, 0.84, 0.44, 1], 'power3.inOut': [0.77, 0, 0.175, 1],
    'power4.in': [0.755, 0.05, 0.855, 0.06], 'power4.out': [0.23, 1, 0.32, 1], 'power4.inOut': [0.86, 0, 0.07, 1],
    'sine.in': [0.47, 0, 0.745, 0.715], 'sine.out': [0.39, 0.575, 0.565, 1], 'sine.inOut': [0.445, 0.05, 0.55, 0.95],
    'expo.in': [0.95, 0.05, 0.795, 0.035], 'expo.out': [0.19, 1, 0.22, 1], 'expo.inOut': [1, 0, 0, 1],
    'circ.in': [0.6, 0.04, 0.98, 0.335], 'circ.out': [0.075, 0.82, 0.165, 1], 'circ.inOut': [0.785, 0.135, 0.15, 0.86],
    'back.in': [0.6, -0.28, 0.735, 0.045], 'back.out': [0.175, 0.885, 0.32, 1.275], 'back.inOut': [0.68, -0.55, 0.265, 1.55],
  };
  function gsapEase(e) {
    if (e == null) return GSAP_EASE['power1.out'];
    if (typeof e !== 'string') return null;
    let k = e.replace(/\(.*\)$/, '');
    if (/^(power[0-4]|sine|expo|circ|back|quad|cubic|quart|quint)$/.test(k)) k += '.out';
    k = k.replace(/^quad/, 'power1').replace(/^cubic/, 'power2').replace(/^quart/, 'power3').replace(/^quint/, 'power4').replace(/^power0/, 'none');
    return GSAP_EASE[k] || null;
  }

  const SKIP_CSS = new Set(['transform', 'opacity', 'translate', 'rotate', 'scale', 'offset', 'composite', 'easing', 'computedOffset']);
  const kebab = (s) => s.replace(/[A-Z]/g, (m) => '-' + m.toLowerCase());
  const GSAP_TRANSFORM = new Set(['x', 'y', 'z', 'xPercent', 'yPercent', 'rotation', 'rotate', 'rotationX', 'rotationY', 'rotateX', 'rotateY', 'rotationZ', 'scale', 'scaleX', 'scaleY', 'skewX', 'skewY', 'transform', 'transformOrigin', 'transformPerspective', 'svgOrigin']);
  const GSAP_RESERVED = new Set(['duration', 'ease', 'delay', 'stagger', 'repeat', 'yoyo', 'repeatDelay', 'paused', 'immediateRender', 'overwrite', 'keyframes', 'id', 'data', 'runBackwards', 'startAt', 'callbackScope', 'lazy', 'inherit', 'reversed', 'yoyoEase', 'onComplete', 'onStart', 'onUpdate', 'onRepeat', 'onReverseComplete', 'onInterrupt', 'autoRound', 'css', 'attr', 'modifiers', 'snap', 'motionPath', 'text', 'scrollTrigger', 'onCompleteParams', 'onStartParams', 'onUpdateParams', 'parent', 'defaults', 'smoothChildTiming', 'autoRemoveChildren']);

  /**
   * Inspect page animations. segments: per element, list of {t0,t1,ease,props:Set,loop}.
   * Then values are SAMPLED from computed style at segment boundaries (exact w.r.t. browser maths).
   */
  function analyze(opts = {}) {
    const fps = opts.fps || 30, maxDur = opts.maxDuration || 30;
    const els = new Map(); // el → {segs:[], cssProps:Set}
    const entry = (el) => { let e = els.get(el); if (!e) els.set(el, (e = { segs: [], cssProps: new Set(), sources: new Set(), loops: {} })); return e; };
    const isOurs = (a) => a.effect && a.effect.target && a.effect.target.nodeType === 1 && !a.effect.pseudoElement && !(G.CSSTransition && a instanceof CSSTransition);
    if (G.gsap && G.gsap.globalTimeline) G.gsap.globalTimeline.autoRemoveChildren = false;
    const birth = new Map();
    const collect = () => { if (D.getAnimations) for (const a of D.getAnimations()) if (isOurs(a) && !birth.has(a)) birth.set(a, clock.t / 1000); };
    collect();
    // run the page's own timeline (timers, rAF, GSAP ticker) so late-starting animations are found
    const step = 1000 / fps;
    while (clock.t < maxDur * 1000) { advanceTo(clock.t + step, step); collect(); }
    const anims = [...birth.keys()];
    let end = 0;

    // --- CSS animations / WAAPI ---
    for (const a of anims) {
      const ef = a.effect, tm = ef.getTiming(), el = ef.target, e = entry(el);
      e.sources.add(a.animationName ? 'css' : 'waapi');
      const kfs = ef.getKeyframes();
      const dur = typeof tm.duration === 'number' ? tm.duration / 1000 : 0, delay = (tm.delay || 0) / 1000;
      const start = birth.get(a) + delay;
      const infinite = tm.iterations === Infinity, iters = infinite ? 1 : Math.min(tm.iterations || 1, 50);
      const dir = tm.direction || 'normal';
      const whole = parseCssEase(tm.easing);
      for (const k of kfs) for (const p of Object.keys(k)) if (!SKIP_CSS.has(p) && k[p] != null) e.cssProps.add(kebab(p));
      const tf = kfs.some((k) => k.transform != null || k.translate != null || k.rotate != null || k.scale != null);
      const op = kfs.some((k) => k.opacity != null);
      const props = new Set([...(tf ? ['tf'] : []), ...(op ? ['opacity'] : []), ...[...e.cssProps].map((p) => 'css.' + p)]);
      for (let it = 0; it < iters; it++) {
        const rev = dir === 'reverse' || (dir === 'alternate' && it % 2) || (dir === 'alternate-reverse' && !(it % 2));
        const base = start + it * dur;
        for (let i = 0; i < kfs.length - 1; i++) {
          const ka = kfs[i], kb = kfs[i + 1];
          let o0 = ka.computedOffset, o1 = kb.computedOffset;
          let ease = whole === CSS_EASE.linear || whole === null && kfs.length > 2 ? parseCssEase(ka.easing) : kfs.length === 2 ? whole : null;
          if (ease === null && whole && whole !== CSS_EASE.linear && kfs.length === 2) ease = whole;
          if (rev) { [o0, o1] = [1 - o1, 1 - o0]; if (Array.isArray(ease)) ease = [1 - ease[2], 1 - ease[3], 1 - ease[0], 1 - ease[1]]; }
          e.segs.push({ t0: base + o0 * dur, t1: base + o1 * dur, ease, props });
        }
      }
      if (infinite) for (const p of props) e.loops[p] = dir.includes('alternate') ? 'pingpong' : 'cycle';
      end = Math.max(end, start + dur * iters);
    }

    // --- GSAP ---
    const gsap = G.gsap;
    const gsapTargets = new Set();
    if (gsap && gsap.globalTimeline) {
      const walk = (tl, off) => {
        for (const ch of tl.getChildren(false, true, true)) {
          const st = off + ch.startTime();
          if (ch.getChildren) { walk(ch, st); continue; }
          const v = ch.vars || {}, targets = ch.targets().filter((t) => t && t.nodeType === 1);
          if (!targets.length) continue;
          const each = ch.duration(), rep = ch.repeat(), yoyo = ch.yoyo(), rd = ch.repeatDelay ? ch.repeatDelay() : 0;
          const total = rep < 0 ? each : ch.totalDuration();
          let stag = 0;
          if (v.stagger != null) stag = typeof v.stagger === 'number' ? v.stagger : typeof v.stagger === 'object' ? v.stagger.each || (v.stagger.amount || 0) / Math.max(1, targets.length - 1) : 0;
          const keys = Object.keys(v).filter((k) => !GSAP_RESERVED.has(k) && !k.startsWith('on'));
          const css = keys.filter((k) => !GSAP_TRANSFORM.has(k) && k !== 'opacity' && k !== 'autoAlpha').map(kebab);
          if (v.css) css.push(...Object.keys(v.css).filter((k) => !GSAP_TRANSFORM.has(k) && k !== 'opacity').map(kebab));
          const props = new Set([...(keys.some((k) => GSAP_TRANSFORM.has(k)) || (v.css && Object.keys(v.css).some((k) => GSAP_TRANSFORM.has(k))) ? ['tf'] : []),
            ...(keys.includes('opacity') || keys.includes('autoAlpha') ? ['opacity'] : []), ...css.map((p) => 'css.' + p)]);
          const ease = gsapEase(v.ease);
          targets.forEach((el, i) => {
            const e = entry(el); e.sources.add('gsap'); gsapTargets.add(el);
            css.forEach((p) => e.cssProps.add(p));
            const s0 = st + i * stag, cycles = rep < 0 ? 1 : rep + 1;
            for (let c = 0; c < cycles; c++) {
              const t0 = s0 + c * (each + rd), back = yoyo && c % 2;
              e.segs.push({ t0, t1: t0 + each, ease: back && ease ? [1 - ease[2], 1 - ease[3], 1 - ease[0], 1 - ease[1]] : ease, props });
            }
            if (rep < 0) for (const p of props) e.loops[p] = yoyo ? 'pingpong' : 'cycle';
            end = Math.max(end, s0 + (rep < 0 ? each : total));
          });
        }
      };
      walk(gsap.globalTimeline, 0);
    }

    // --- sampling ---
    end = Math.min(Math.max(end, 0.5), maxDur);
    const elist = [...els.keys()];
    let curT = NaN;
    const setTime = (t) => {
      if (t === curT) return; curT = t;
      for (const a of anims) { a.pause(); a.currentTime = (t - birth.get(a)) * 1000; }
      if (gsap) { gsap.globalTimeline.pause(); gsap.globalTimeline.totalTime(t, false); }
    };
    // rest geometry with every original animation removed
    stripOriginals(anims, gsapTargets, false);
    const rest = new Map(elist.map((el) => [el, measure(el)]));
    for (const a of anims) { try { a.play(); a.pause(); } catch (e) {} }
    // nearest animated DOM ancestor: children are stored in its local space (it moves them via the DOM)
    const ancOf = new Map();
    for (const el of elist) for (let a = el.parentElement; a; a = a.parentElement) if (els.has(a)) { ancOf.set(el, a); break; }
    const stageX = (el) => {
      const cs = getComputedStyle(el), r = rest.get(el);
      const tr = cs.transform && cs.transform !== 'none' ? M(cs.transform) : M();
      const [ox, oy, oz] = cs.transformOrigin.split(' ').map(parseFloat);
      const A = M().translate(ox, oy, oz || 0).multiply(tr).translate(-ox, -oy, -(oz || 0));
      return r.E0.multiply(A).multiply(r.E0inv); // X · rest = animated (stage space)
    };
    const sample = (el, t) => {
      setTime(t);
      const cs = getComputedStyle(el), r = rest.get(el);
      let X = stageX(el);
      const anc = ancOf.get(el);
      if (anc) { const inv = stageX(anc).inverse(); if (Number.isFinite(inv.m11) && Number.isFinite(inv.m41)) X = inv.multiply(X); }
      const out = { tf: decompose(X, r.c), opacity: +cs.opacity * 100 };
      if (cs.visibility === 'hidden') out.opacity = 0;
      for (const p of els.get(el).cssProps) out['css.' + p] = cs.getPropertyValue(p);
      return out;
    };

    const TF = ['x', 'y', 'z', 'rotation', 'rotX', 'rotY', 'sx', 'sy'];
    const ROT = new Set(['rotation', 'rotX', 'rotY']);
    const flat = (s) => { const o = { opacity: s.opacity }; for (const k of TF) o[k] = s.tf[k]; for (const k in s) if (k.startsWith('css.')) o[k] = s[k]; return o; };
    const layers = [];
    for (const el of elist) {
      const e = els.get(el), r = rest.get(el);
      const tracks = {}, loops = {}, lastRot = {};
      const push = (path, t, v) => {
        const k = (tracks[path] ||= []);
        const last = k[k.length - 1];
        if (last && Math.abs(last.t - t) < 1e-4) { last.v = v; return last; }
        const key = { id: 'k' + Math.random().toString(36).slice(2, 9), t: r4(t), v, ease: [0, 0, 1, 1] };
        k.push(key); return key;
      };
      const unwrap = (k, v) => { if (lastRot[k] != null) { while (v - lastRot[k] > 180) v -= 360; while (v - lastRot[k] < -180) v += 360; } lastRot[k] = v; return v; };
      const chans = (sg) => [...sg.props].flatMap((p) => (p === 'tf' ? TF : [p]));
      const at0 = flat(sample(el, 0));
      e.segs.sort((a, b) => a.t0 - b.t0);
      for (const sg of e.segs) {
        const t0 = Math.max(0, sg.t0), t1 = Math.min(sg.t1, maxDur * 4);
        if (t1 <= t0) continue;
        const cs = chans(sg);
        const N = Math.min(240, Math.max(16, Math.ceil((t1 - t0) * fps * 2)));
        const xs = Array.from({ length: N + 1 }, (_, i) => i / N);
        const S = xs.map((x, i) => flat(sample(el, i === 0 ? t0 + 1e-4 : i === N ? t1 - 1e-5 : t0 + (t1 - t0) * x)));
        for (const k of cs) if (ROT.has(k)) S.forEach((s) => (s[k] = unwrap(k, s[k])));
        // pre-roll: value before the first segment differs (delayed animation without backwards fill)
        for (const k of cs) if (!tracks[k] && t0 > 1e-3) {
          const v0 = at0[k];
          if (typeof v0 === 'number' ? Math.abs(v0 - S[0][k]) > 1e-3 : v0 !== S[0][k]) { const kk = push(k, 0, typeof v0 === 'number' ? r4(v0) : v0); kk.hold = true; }
        }
        // per channel keyframe reduction: fit cubic-bezier pieces, splitting at overshoot peaks /
        // worst-fit points until every piece is within 0.1 px·°·% of the real motion; else bake the piece.
        const TOL = 0.1;
        const tAt = (i) => (i === 0 ? t0 : i === N ? t1 : t0 + (t1 - t0) * xs[i]);
        for (const k of cs) {
          const key = (t, v, ease) => { const a = push(k, t, typeof v === 'number' ? r4(v) : v); if (ease) { a.ease = ease; delete a.hold; } return a; };
          if (sg.ease === 'hold') { key(t0, S[0][k]).hold = true; key(t1, S[N][k]); continue; }
          if (typeof S[0][k] !== 'number') { key(t0, S[0][k], [0, 0, 1, 1]); key(t1, S[N][k]); continue; }
          const out = []; // [index, ease]
          const piece = (i0, i1, depth) => {
            const v0 = S[i0][k], v1 = S[i1][k], lo = Math.min(v0, v1) - 0.05, hi = Math.max(v0, v1) + 0.05;
            let ext = -1, extD = 0;
            for (let i = i0 + 1; i < i1; i++) { const v = S[i][k], d = v < lo ? lo - v : v > hi ? v - hi : 0; if (d > extD) { extD = d; ext = i; } }
            if (ext > 0 && depth < 6) { piece(i0, ext, depth + 1); piece(ext, i1, depth + 1); return; }
            if (Math.abs(v1 - v0) <= 0.05) { out.push([i0, [0, 0, 1, 1]]); return; }
            const span = xs[i1] - xs[i0], idx = [];
            for (let i = i0; i <= i1; i++) idx.push(i);
            const f = fitBezier(idx.map((i) => (xs[i] - xs[i0]) / span), idx.map((i) => (S[i][k] - v0) / (v1 - v0)), Array.isArray(sg.ease) && depth === 0 ? sg.ease : null);
            if (f.err * Math.abs(v1 - v0) <= TOL) { out.push([i0, f.e]); return; }
            if (depth < 6 && i1 - i0 >= 6) {
              const fe = cubicBezier(...f.e); let m = -1, md = 0;
              for (let i = i0 + 2; i <= i1 - 2; i++) { const d = Math.abs(fe((xs[i] - xs[i0]) / span) - (S[i][k] - v0) / (v1 - v0)); if (d > md) { md = d; m = i; } }
              if (m > 0) { piece(i0, m, depth + 1); piece(m, i1, depth + 1); return; }
            }
            for (let i = i0; i < i1; i++) out.push([i, [0, 0, 1, 1]]); // bake
          };
          piece(0, N, 0);
          for (const [i, e] of out) key(tAt(i), S[i][k], e);
          key(t1, S[N][k]);
        }
      }
      for (const ks of Object.values(tracks)) ks.sort((a, b) => a.t - b.t);
      // scale: uniform → 'scale', otherwise 'scaleX'/'scaleY'
      const st0 = decompose(r.S, r.c);
      const sxk = tracks.sx || [], syk = tracks.sy || [];
      const uniform = Math.abs(st0.sx - st0.sy) < 0.1 && sxk.length === syk.length && sxk.every((k, i) => Math.abs(k.v - syk[i].v) < 0.1 && Math.abs(k.t - syk[i].t) < 1e-4);
      if (uniform) { if (sxk.length) tracks.scale = sxk; }
      else { if (sxk.length) tracks.scaleX = sxk; if (syk.length) tracks.scaleY = syk; }
      delete tracks.sx; delete tracks.sy;
      for (const [k, ks] of Object.entries(tracks)) {
        // drop tracks that never visibly change (scale < 0.1 %, others < 0.02 units)
        const eps = /^scale/.test(k) ? 0.1 : 0.02;
        if (ks.every((x) => (typeof x.v === 'number' ? Math.abs(x.v - ks[0].v) < eps : x.v === ks[0].v))) delete tracks[k];
        else { const lp = e.loops[k] || e.loops[[...TF, 'scale', 'scaleX', 'scaleY'].includes(k) ? 'tf' : k]; if (lp) loops[k] = lp; }
      }
      const base = { ...propsFromStatic(r, uniform), opacity: r4(+getComputedStyle(el).opacity * 100) };
      layers.push({ selector: selectorFor(el), name: labelFor(el), sources: [...e.sources], props: base, tracks, loops });
    }
    // detect DOM nesting between found layers (implicit parent via DOM)
    stripOriginals(anims, gsapTargets, true);
    const procedural = !!D.querySelector('canvas') || (gsap && gsap.globalTimeline.getChildren(true, true, false).some((t) => t.targets().some((x) => x && x.nodeType !== 1)));
    return { layers, duration: Math.ceil(end * 2) / 2, hasGsap: !!gsap, procedural };
  }

  function propsFromStatic(g, uniform = true) {
    const d = decompose(g.S, g.c);
    const o = { x: d.x, y: d.y, z: d.z, rotation: d.rotation, rotX: d.rotX, rotY: d.rotY, scale: 100, scaleX: 100, scaleY: 100 };
    if (uniform && Math.abs(d.sx - d.sy) < 0.01) o.scale = d.sx; else { o.scaleX = d.sx; o.scaleY = d.sy; }
    return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, r4(v)]));
  }
  let stripStyle;
  const domTween = (c) => c.targets && c.targets().some((x) => x && x.nodeType === 1);
  function killDomTweens() {
    const gsap = G.gsap; if (!gsap || !gsap.globalTimeline) return;
    for (const c of gsap.globalTimeline.getChildren(true, true, false)) if (domTween(c)) {
      const ts = c.targets(); c.kill();
      ts.forEach((el) => el && el.style && ['transform', 'translate', 'rotate', 'scale', 'opacity', 'visibility'].forEach((p) => el.style.removeProperty(p)));
    }
  }
  /** While the project drives the page, anything the page starts later on DOM elements is removed. */
  function suppressNew() {
    if (D.getAnimations) for (const a of D.getAnimations()) if (a.effect && a.effect.target && a.effect.target.nodeType === 1 && !a.effect.pseudoElement && !(state.kept || []).includes(a)) a.cancel();
    killDomTweens();
  }
  function stripOriginals(anims, gsapTargets, final) {
    anims = anims || (D.getAnimations ? D.getAnimations().filter((a) => a.effect && a.effect.target && !a.effect.pseudoElement) : []);
    for (const a of anims) { try { a.cancel(); } catch (e) {} }
    if (!stripStyle) {
      stripStyle = D.createElement('style'); stripStyle.id = '__motion_strip';
      stripStyle.textContent = '*:not(.__m_keep){animation:none!important;transition:none!important}';
      (D.head || D.documentElement).appendChild(stripStyle);
    }
    const gsap = G.gsap;
    if (gsap && gsap.globalTimeline) {
      const targets = gsapTargets || new Set();
      if (!gsapTargets) gsap.globalTimeline.getChildren(true, true, false).forEach((t) => t.targets().forEach((x) => x && x.nodeType === 1 && targets.add(x)));
      if (final) killDomTweens();
      else { gsap.globalTimeline.pause(); gsap.globalTimeline.totalTime(0, false); }
      targets.forEach((el) => ['transform', 'translate', 'rotate', 'scale', 'opacity', 'visibility'].forEach((p) => el.style.removeProperty(p)));
    }
  }

  // ───────────────────────────── 5. render ─────────────────────────────
  const state = { project: null, nodes: new Map(), root: null, svg: null, fx: null, t: 0, ready: false };
  const hexRgb = (h) => { const n = parseInt(String(h).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgba = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };

  function resolve(layer, t) {
    const p = { ...layer.props }, content = { ...(layer.content || {}) }, css = {};
    const effects = (layer.effects || []).map((e) => ({ ...e, params: { ...e.params } }));
    for (const [path, keys] of Object.entries(layer.tracks || {})) {
      if (!keys || !keys.length) continue;
      const v = valueAt(keys, t, layer.loops && layer.loops[path]);
      if (path.startsWith('css.')) css[path.slice(4)] = v;
      else if (path.startsWith('c.')) content[path.slice(2)] = v;
      else if (path.startsWith('fx.')) { const [, id, k] = path.split('.'); const e = effects.find((x) => x.id === id); if (e) e.params[k] = v; }
      else p[path] = v;
    }
    return { p, content, css, effects };
  }

  function ensureRoot() {
    if (state.root) return;
    const P = state.project;
    state.root = D.createElement('div'); state.root.id = '__motion_root';
    state.root.style.cssText = 'position:absolute;left:0;top:0;width:0;height:0;overflow:visible;pointer-events:none;z-index:2147483000';
    D.body.appendChild(state.root);
    state.svg = D.createElementNS('http://www.w3.org/2000/svg', 'svg');
    state.svg.setAttribute('style', 'position:absolute;width:0;height:0;overflow:hidden');
    state.svg.innerHTML = '<defs></defs>';
    D.body.appendChild(state.svg);
    state.fx = D.createElement('div'); state.fx.id = '__motion_compfx';
    state.fx.style.cssText = `position:fixed;left:0;top:0;width:${P.width}px;height:${P.height}px;pointer-events:none;z-index:2147483600`;
    state.fx.innerHTML = '<div data-v style="position:absolute;inset:0"></div><canvas data-g style="position:absolute;inset:0;width:100%;height:100%;mix-blend-mode:overlay"></canvas>';
    D.body.appendChild(state.fx);
  }

  function buildCreated(layer) {
    const c = layer.content || {}; let el;
    if (layer.type === 'image') { el = D.createElement('img'); el.draggable = false; }
    else el = D.createElement('div');
    el.dataset.motionLayer = layer.id;
    el.style.position = 'absolute'; el.style.left = '0'; el.style.top = '0'; el.style.whiteSpace = 'pre'; el.style.pointerEvents = 'auto';
    state.root.appendChild(el);
    return el;
  }
  function applyContent(node, layer, content) {
    const el = node.el, c = content, s = el.style;
    const sig = JSON.stringify(c);
    if (node.contentSig === sig) return false;
    node.contentSig = sig;
    if (layer.type === 'text') {
      el.textContent = c.text; s.font = `${c.fontWeight} ${c.fontSize}px ${c.fontFamily}`; s.color = c.color;
      s.letterSpacing = (c.letterSpacing || 0) + 'px'; s.lineHeight = '1.15'; s.textAlign = c.align || 'center';
    } else if (layer.type === 'rect' || layer.type === 'ellipse' || layer.type === 'solid') {
      s.width = c.width + 'px'; s.height = c.height + 'px'; s.background = c.color;
      s.borderRadius = layer.type === 'ellipse' ? '50%' : (c.radius || 0) + 'px';
      s.boxSizing = 'border-box'; s.border = c.strokeWidth ? `${c.strokeWidth}px solid ${c.strokeColor}` : 'none';
    } else if (layer.type === 'image') {
      const a = state.project.assets && state.project.assets[c.assetId];
      if (a && el.getAttribute('src') !== a.url) el.src = a.url;
      if (c.width) s.width = c.width + 'px'; if (c.height) s.height = c.height + 'px';
    } else if (layer.type === 'null') { s.width = '0px'; s.height = '0px'; }
    return true;
  }

  function filterFor(node, effects) {
    const parts = [];
    for (const e of effects) {
      if (!e.enabled) continue;
      const q = e.params;
      switch (e.type) {
        case 'blur': if (q.radius > 0) parts.push(`blur(${q.radius}px)`); break;
        case 'shadow': { const a = ((q.angle - 90) * Math.PI) / 180; parts.push(`drop-shadow(${(Math.cos(a) * q.distance).toFixed(2)}px ${(Math.sin(a) * q.distance).toFixed(2)}px ${q.softness}px ${rgba(q.color, q.opacity / 100)})`); break; }
        case 'glow': { let k = q.intensity; while (k > 0) { parts.push(`drop-shadow(0 0 ${q.radius * (k >= 1 ? 1 : k)}px ${q.color})`); k -= 1; } break; }
        case 'color': parts.push(`brightness(${q.brightness}%) contrast(${q.contrast}%) saturate(${q.saturation}%) hue-rotate(${q.hue}deg)`); break;
        case 'tint': case 'rgbSplit': parts.push(`url(#${svgFilter(node, e)})`); break;
      }
    }
    return parts.join(' ');
  }
  function svgFilter(node, e) {
    const id = `mf_${node.key}_${e.id}`;
    let f = D.getElementById(id);
    if (!f) { f = D.createElementNS('http://www.w3.org/2000/svg', 'filter'); f.id = id; f.setAttribute('color-interpolation-filters', 'sRGB'); f.setAttribute('x', '-20%'); f.setAttribute('y', '-20%'); f.setAttribute('width', '140%'); f.setAttribute('height', '140%'); state.svg.firstChild.appendChild(f); }
    const q = e.params;
    if (e.type === 'tint') {
      const a = q.amount / 100, [r, g, b] = hexRgb(q.color).map((x) => x / 255), L = [0.2126, 0.7152, 0.0722];
      const row = (ch, idx) => [0, 1, 2].map((j) => ((1 - a) * (j === idx ? 1 : 0) + a * ch * L[j]).toFixed(4)).join(' ') + ' 0 0';
      f.innerHTML = `<feColorMatrix type="matrix" values="${row(r, 0)} ${row(g, 1)} ${row(b, 2)} 0 0 0 1 0"/>`;
    } else {
      const d = q.amount, a = ((q.angle || 0) * Math.PI) / 180, dx = (Math.cos(a) * d).toFixed(2), dy = (Math.sin(a) * d).toFixed(2);
      f.innerHTML = `<feColorMatrix in="SourceGraphic" type="matrix" values="1 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 1 0" result="r"/>
        <feOffset in="r" dx="${dx}" dy="${dy}" result="ro"/>
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 1 0 0 0 0 0 0 0 0 0 0 0 1 0" result="g"/>
        <feColorMatrix in="SourceGraphic" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 1 0 0 0 0 0 1 0" result="b"/>
        <feOffset in="b" dx="${-dx}" dy="${-dy}" result="bo"/>
        <feBlend in="ro" in2="g" mode="screen" result="rg"/><feBlend in="rg" in2="bo" mode="screen"/>`;
    }
    return id;
  }

  /** Comp-level effects (adjustment on the whole frame). */
  function renderComp(t) {
    const P = state.project, comp = P.comp || { effects: [], tracks: {} };
    const r = resolve({ props: {}, effects: comp.effects, tracks: comp.tracks, loops: comp.loops }, t);
    const node = (state.compNode ||= { key: 'comp' });
    const filt = filterFor(node, r.effects.filter((e) => e.type !== 'vignette' && e.type !== 'grain'));
    if (D.body.style.filter !== filt) D.body.style.filter = filt;
    const vig = r.effects.find((e) => e.type === 'vignette' && e.enabled), v = state.fx.querySelector('[data-v]');
    v.style.background = vig ? `radial-gradient(ellipse at center, transparent ${(1 - vig.params.amount) * 60}%, rgba(0,0,0,${Math.min(1, vig.params.amount)}) 100%)` : 'none';
    const gr = r.effects.find((e) => e.type === 'grain' && e.enabled), cv = state.fx.querySelector('[data-g]');
    cv.style.display = gr ? 'block' : 'none';
    if (gr) {
      const w = 480, h = Math.round((480 * P.height) / P.width); if (cv.width !== w) { cv.width = w; cv.height = h; }
      const ctx = cv.getContext('2d'), img = ctx.createImageData(w, h);
      let s = (Math.floor(t * P.fps) * 2654435761) >>> 0;
      for (let i = 0; i < img.data.length; i += 4) { s = (s * 1664525 + 1013904223) >>> 0; const n = s >>> 24; img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = gr.params.amount * 255; }
      ctx.putImageData(img, 0, 0);
    }
  }

  function syncNodes() {
    const P = state.project, keep = new Set();
    P.layers.forEach((layer, i) => {
      keep.add(layer.id);
      let n = state.nodes.get(layer.id);
      if (!n) {
        let el = null;
        if (layer.selector) el = D.querySelector(layer.selector);
        else { ensureRoot(); el = buildCreated(layer); }
        n = { el, key: layer.id.replace(/[^a-z0-9]/gi, ''), created: !layer.selector, geo: null };
        state.nodes.set(layer.id, n);
      }
      if (n.created && n.el) n.el.style.zIndex = String(P.layers.length - i);
    });
    for (const [id, n] of state.nodes) if (!keep.has(id)) { if (n.created) n.el.remove(); else if (n.el) { n.el.style.transform = n.el.style.opacity = n.el.style.filter = ''; } state.nodes.delete(id); }
    // DOM ancestry among layers (implicit parenting through the DOM)
    for (const [, n] of state.nodes) {
      n.domParent = null;
      if (!n.el || n.created) continue;
      for (let a = n.el.parentElement; a; a = a.parentElement) { const hit = [...state.nodes].find(([, m]) => m.el === a); if (hit) { n.domParent = hit[0]; break; } }
    }
  }
  function remeasure() {
    for (const [, n] of state.nodes) if (n.el) { n.el.style.transform = ''; }
    for (const [id, n] of state.nodes) if (n.el) n.geo = measure(n.el);
    state.measured = true;
  }

  const persp = (P) => { const d = P.perspective || 1600, cx = P.width / 2, cy = P.height / 2; return T(cx, cy).multiply(M([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, -1 / d, 0, 0, 0, 1])).translate(-cx, -cy); };

  /** Render the frame at time t (seconds). */
  function render(t) {
    const P = state.project; if (!P) return;
    state.t = t;
    advanceTo(t * 1000, 1000 / (P.fps || 30));
    if (state.ready) suppressNew();
    for (const a of state.kept || []) { try { a.currentTime = t * 1000; } catch (e) {} }
    const byId = new Map(P.layers.map((l) => [l.id, l]));
    const res = new Map(), world = new Map();
    for (const l of P.layers) res.set(l.id, resolve(l, t));
    const W = (id, guard = 0) => {
      if (world.has(id)) return world.get(id);
      const l = byId.get(id), n = state.nodes.get(id);
      if (!l || !n || !n.geo || guard > 32) return M();
      const r = res.get(id), c = n.geo.c;
      const pos = { ...r.p };
      let m;
      if (l.parent && byId.has(l.parent)) {
        const pn = state.nodes.get(l.parent);
        const pc = pn && pn.geo ? pn.geo.c : { x: 0, y: 0 };
        // child position is expressed in the parent's space (relative to parent rest center)
        m = W(l.parent, guard + 1).multiply(T(pc.x, pc.y)).multiply(composeLocal(pos, c));
      } else if (n.domParent) m = W(n.domParent, guard + 1).multiply(composeLocal(pos, c));
      else m = composeLocal(pos, c);
      world.set(id, m); return m;
    };
    const P3 = persp(P);
    for (const l of P.layers) {
      const n = state.nodes.get(l.id); if (!n || !n.el) continue;
      const r = res.get(l.id);
      if (n.created) { if (applyContent(n, l, r.content)) n.geo = measure(n.el); }
      if (!n.geo) n.geo = measure(n.el);
      const visible = l.visible !== false && t >= (l.inPoint ?? 0) && t < (l.outPoint ?? Infinity);
      const s = n.el.style;
      const Wm = W(l.id);
      const anc = n.domParent ? W(n.domParent) : null;
      let X = anc ? anc.inverse().multiply(Wm) : Wm;
      const is3D = !anc && !Wm.is2D;
      if (is3D) X = P3.multiply(X);
      const g = n.geo;
      const css = g.E0inv.multiply(X).multiply(g.E0);
      s.transformOrigin = '0 0';
      if (n.el instanceof SVGElement && n.el.tagName.toLowerCase() !== 'svg') s.transformBox = 'fill-box';
      s.transform = css.toString();
      s.opacity = visible ? String(Math.max(0, Math.min(1, r.p.opacity / 100))) : '0';
      if (l.blend) s.mixBlendMode = l.blend;
      const f = filterFor(n, r.effects); if (s.filter !== f) s.filter = f;
      for (const [k, v] of Object.entries(r.css)) s.setProperty(k, v);
      n.world = is3D ? P3.multiply(Wm) : Wm; n.raw = Wm;
    }
    renderComp(t);
  }

  // ───────────────────────────── 6. public API ─────────────────────────────
  function waitAssets() {
    const imgs = [...D.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; }));
    return Promise.all([D.fonts ? D.fonts.ready : null, ...imgs]);
  }
  const MR = {
    clock, valueAt, cubicBezier, selectorFor, labelFor, advanceTo,
    /** Called by the editor on a fresh (un-stripped) document. */
    async analyze(opts) { await waitAssets(); return analyze(opts); },
    /** Load a project and take control of the page. */
    async load(project) {
      await waitAssets();
      if (!stripStyle) stripOriginals(null, null, true);
      // keep pseudo-element animations, but drive them from the timeline
      state.kept = D.getAnimations ? D.getAnimations().filter((a) => a.effect && a.effect.pseudoElement) : [];
      state.kept.forEach((a) => a.pause());
      state.project = project;
      D.documentElement.style.overflow = 'hidden';
      ensureRoot(); syncNodes(); remeasure(); render(0);
      state.ready = true;
      return true;
    },
    /** Replace project data (edits). Structure changes re-sync nodes. */
    update(project, { remeasure: rm } = {}) {
      state.project = project; syncNodes();
      if (rm) remeasure();
      render(state.t);
    },
    seek(t) { render(t); },
    get time() { return state.t; },
    /** Editor helpers */
    /** Hit-test: exact layer → that layer; inside a layer → the layer (deep=true picks the element itself). */
    layerAt(x, y, deep) {
      const els = D.elementsFromPoint(x, y).filter((el) => el !== D.body && el !== D.documentElement && !(state.fx && state.fx.contains(el)) && el !== state.root);
      const byEl = new Map([...state.nodes].map(([id, n]) => [n.el, id]));
      for (const el of els) {
        if (byEl.has(el)) return { layerId: byEl.get(el) };
        if (!deep) for (let a = el.parentElement; a && a !== D.body; a = a.parentElement) if (byEl.has(a) && !state.nodes.get(byEl.get(a)).created) return { layerId: byEl.get(a) };
        if (state.root && state.root.contains(el)) continue;
        return { selector: selectorFor(el), name: labelFor(el), el };
      }
      return null;
    },
    quad(id) {
      const n = state.nodes.get(id); if (!n || !n.geo || !n.world) return null;
      return n.geo.quad.map((p) => { const q = n.world.transformPoint(new DOMPoint(p.x, p.y)); return { x: q.x, y: q.y }; });
    },
    /** Props for layer `id` so that it keeps its current look under `parentId` (null = unparent). */
    reparentProps(id, parentId) {
      const n = state.nodes.get(id); if (!n || !n.raw) return null;
      let base = n.domParent && !parentId ? state.nodes.get(n.domParent).raw || M() : M();
      if (parentId) { const pn = state.nodes.get(parentId); if (!pn || !pn.raw) return null; base = pn.raw.multiply(T(pn.geo.c.x, pn.geo.c.y)); }
      const d = decompose(base.inverse().multiply(n.raw), n.geo.c);
      return Object.fromEntries(Object.entries(d).map(([k, v]) => [k, r4(v)]));
    },
    /** Convert a stage-space drag delta into the layer's parent space. */
    toParentDelta(id, dx, dy) {
      const n = state.nodes.get(id), l = state.project && state.project.layers.find((x) => x.id === id);
      let P = null;
      if (l && l.parent && state.nodes.get(l.parent)) P = state.nodes.get(l.parent).raw;
      else if (n && n.domParent) P = state.nodes.get(n.domParent).raw;
      if (!P) return { x: dx, y: dy };
      const inv = P.inverse(), a = inv.transformPoint(new DOMPoint(0, 0)), b = inv.transformPoint(new DOMPoint(dx, dy));
      return { x: b.x - a.x, y: b.y - a.y };
    },
    elementRect(sel) { const el = D.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; },
    restCenter(id) { const n = state.nodes.get(id); return n && n.geo ? { ...n.geo.c } : null; },
    worldMatrix(id) { const n = state.nodes.get(id); return n && n.world ? n.world.toFloat64Array() : null; },
    /** Base props + label for turning any element into a layer (editor pick). */
    describe(sel) {
      const el = D.querySelector(sel); if (!el) return null;
      const prev = el.style.transform; el.style.transform = '';
      const g = measure(el); el.style.transform = prev;
      return { selector: sel, name: labelFor(el), props: { ...propsFromStatic(g), opacity: r4(+getComputedStyle(el).opacity * 100) } };
    },
    /** Exported page: autoplay in real time unless ?render */
    play(opts = {}) {
      const P = state.project; let start = null; const loop = opts.loop !== false;
      const audio = P.audio && P.audio.url ? Object.assign(new Audio(P.audio.url), { volume: P.audio.volume ?? 1 }) : null;
      const tick = (now) => {
        if (start === null) { start = now; if (audio) { audio.currentTime = Math.max(0, -(P.audio.offset || 0)); audio.play().catch(() => {}); } }
        let t = (now - start) / 1000;
        if (t >= P.duration) {
          if (!loop) { render(P.duration - 1e-4); return; }
          G.location.reload(); return; // procedural content cannot run backwards: restart cleanly
        }
        render(t); real.raf(tick);
      };
      real.raf(tick);
    },
  };
  G.MotionRuntime = MR;
})(window);
