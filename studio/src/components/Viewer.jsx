import { useEffect, useRef, useState, useCallback } from 'react';
import { useStore, targetOf } from '../store.js';
import { withRuntime, runtimeProject, preferLocalVendors } from '../engine/document.js';
import { setRT, getRT } from '../engine/bridge.js';
import { getValue, setValue } from '../engine/project.js';
import { draftTarget } from '../store.js';
import { addElementLayer, addImageLayer } from '../engine/actions.js';
import { Select, IconBtn, cx } from './ui.jsx';
import { Grid3x3, Loader2 } from 'lucide-react';

const S = () => useStore.getState();

export default function Viewer() {
  const sourceRev = useStore((s) => s.sourceRev);
  const W = useStore((s) => s.project.width), H = useStore((s) => s.project.height);
  const procedural = useStore((s) => s.project.procedural);
  const zoom = useStore((s) => s.ui.viewZoom), guides = useStore((s) => s.ui.guides);
  const selLayers = useStore((s) => s.sel.layers);
  const boxRef = useRef(null), frameRef = useRef(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [hover, setHover] = useState(null);
  const live = useRef({ lastT: 0, reloading: false, raf: 0 });

  // fit
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setBox({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(boxRef.current); return () => ro.disconnect();
  }, []);
  const fit = Math.min((box.w - 40) / W, (box.h - 40) / H);
  const scale = zoom === 'fit' ? Math.max(0.05, fit) : +zoom;

  const redrawOverlay = useCallback(() => { cancelAnimationFrame(live.current.raf); live.current.raf = requestAnimationFrame(() => setTick((t) => t + 1)); }, []);

  // (re)load the page + runtime
  const boot = useCallback(() => {
    const f = frameRef.current; if (!f) return;
    setLoading(true); setRT(null);
    f.onload = async () => {
      const rt = f.contentWindow?.MotionRuntime;
      if (!rt) { setLoading(false); return; }
      try {
        await rt.load(runtimeProject(S().project, S().assets));
        rt.seek(S().time); live.current.lastT = S().time; setRT(rt);
      } catch (e) { console.error(e); S().toast('런타임 오류: ' + e.message); }
      live.current.reloading = false; setLoading(false); redrawOverlay();
    };
    f.srcdoc = withRuntime(preferLocalVendors(S().project.source));
  }, [redrawOverlay]);
  useEffect(() => { boot(); }, [sourceRev, boot]);

  // project/time → runtime
  useEffect(() => useStore.subscribe((s, p) => {
    const rt = getRT(); if (!rt || live.current.reloading) return;
    const edited = s.rev !== p.rev || s.assets !== p.assets;
    if (edited) rt.update(runtimeProject(s.project, s.assets), { remeasure: s.structureRev !== p.structureRev });
    if (s.time !== p.time || edited) {
      if (s.project.procedural && s.time < live.current.lastT - 1e-6) {
        // script-driven content (canvas/WebGL) cannot run backwards: reload and fast-forward
        live.current.reloading = true; live.current.lastT = s.time; boot(); return;
      }
      rt.seek(s.time); live.current.lastT = s.time;
    }
    if (edited || s.time !== p.time || s.sel !== p.sel) redrawOverlay();
  }), [boot, redrawOverlay]);

  // ── pointer interaction (select / move / scale / rotate / pick any element) ──
  const toComp = (e) => { const r = boxRef.current.querySelector('[data-stage]').getBoundingClientRect(); return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }; };
  const quads = selLayers.map((id) => ({ id, q: getRT()?.quad(id) })).filter((x) => x.q);
  const center = (q) => ({ x: (q[0].x + q[1].x + q[2].x + q[3].x) / 4, y: (q[0].y + q[1].y + q[2].y + q[3].y) / 4 });

  const startDrag = (e, mode, ids) => {
    const p0 = toComp(e), st = S(), t = st.time;
    const start = Object.fromEntries(ids.map((id) => { const l = targetOf(st.project, id); return [id, { x: getValue(l, 'x', t), y: getValue(l, 'y', t), scale: getValue(l, 'scale', t), rotation: getValue(l, 'rotation', t) }]; }));
    const q = ids.length === 1 ? getRT()?.quad(ids[0]) : null, c = q && center(q);
    const move = (ev) => {
      const p = toComp(ev); let dx = p.x - p0.x, dy = p.y - p0.y;
      if (ev.shiftKey && mode === 'move') { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
      S().mutate((d) => {
        for (const id of ids) {
          const l = draftTarget(d, id); if (!l || l.locked) continue; const s0 = start[id];
          if (mode === 'move') { const v = getRT()?.toParentDelta(id, dx, dy) || { x: dx, y: dy }; setValue(l, 'x', +(s0.x + v.x).toFixed(2), t, d.fps); setValue(l, 'y', +(s0.y + v.y).toFixed(2), t, d.fps); }
          else if (mode === 'scale' && c) { const f = Math.hypot(p.x - c.x, p.y - c.y) / Math.max(1, Math.hypot(p0.x - c.x, p0.y - c.y)); setValue(l, 'scale', +(s0.scale * f).toFixed(2), t, d.fps); }
          else if (mode === 'rotate' && c) { let a = (Math.atan2(p.y - c.y, p.x - c.x) - Math.atan2(p0.y - c.y, p0.x - c.x)) * 180 / Math.PI; if (ev.shiftKey) a = Math.round(a / 15) * 15; setValue(l, 'rotation', +(s0.rotation + a).toFixed(2), t, d.fps); }
        }
      }, { merge: 'viewer-' + mode });
    };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    const rt = getRT(); if (!rt) return;
    const p = toComp(e);
    let hit = rt.layerAt(p.x, p.y, e.ctrlKey || e.metaKey);
    if (hit && e.altKey && hit.el?.parentElement && hit.el.parentElement.tagName !== 'BODY') { const par = hit.el.parentElement; hit = { selector: rt.selectorFor(par), name: rt.labelFor(par) }; }
    let id = hit?.layerId;
    if (!id && hit?.selector) { const d = rt.describe(hit.selector); if (d) id = addElementLayer(d); }
    if (!id) { S().select({ layers: [], keys: [] }); return; }
    const layers = e.shiftKey ? (S().sel.layers.includes(id) ? S().sel.layers.filter((x) => x !== id) : [...S().sel.layers, id]) : S().sel.layers.includes(id) ? S().sel.layers : [id];
    S().select({ layers });
    if (layers.includes(id)) startDrag(e, 'move', layers);
  };
  const onMove = (e) => {
    const rt = getRT(); if (!rt || e.buttons) return;
    const p = toComp(e), hit = rt.layerAt(p.x, p.y, e.ctrlKey || e.metaKey);
    if (!hit) return setHover(null);
    if (hit.layerId) return setHover({ quad: rt.quad(hit.layerId), name: targetOf(S().project, hit.layerId)?.name });
    const r = rt.elementRect(hit.selector);
    setHover(r && { rect: r, name: hit.name + '  (클릭: 레이어로 만들기 · Alt: 부모 요소 · Ctrl: 하위 요소)' });
  };
  const onDrop = (e) => {
    const id = e.dataTransfer.getData('motion/asset'); if (!id) return;
    e.preventDefault(); e.stopPropagation();
    const a = S().assets[id]; if (a?.kind === 'image') addImageLayer(id, toComp(e));
  };

  const pts = (q) => q.map((p) => `${p.x * scale},${p.y * scale}`).join(' ');
  return (
    <div className="flex h-full min-w-0 flex-col bg-app">
      <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line px-2 text-mute">
        <span className="font-semibold text-fg">Composition</span>
        <span className="num">{W}×{H}</span>
        {procedural && <span className="rounded bg-amber-500/15 px-1.5 text-amber-300" title="캔버스/WebGL 등 스크립트로 그리는 부분은 원본 그대로 가상 시계로 구동됩니다 (뒤로 이동 시 다시 로드)">Script layer</span>}
        <span className="flex-1" />
        <IconBtn icon={Grid3x3} title="세이프 영역 가이드" active={guides} onClick={() => S().setUi({ guides: !guides })} />
        <Select value={zoom} onChange={(v) => S().setUi({ viewZoom: v })} options={[{ value: 'fit', label: `Fit (${Math.round(fit * 100)}%)` }, ...['0.25', '0.5', '1', '2'].map((v) => ({ value: v, label: `${v * 100}%` }))]} />
      </div>
      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-auto" onDragOver={(e) => e.preventDefault()} onDrop={onDrop}>
        <div className="grid min-h-full min-w-full place-items-center p-5">
          <div data-stage className="relative shadow-[0_0_0_1px_#33363f,0_10px_40px_#0008]" style={{ width: W * scale, height: H * scale }}>
            <iframe ref={frameRef} title="composition" className="absolute left-0 top-0 origin-top-left border-0 bg-black"
              style={{ width: W, height: H, transform: `scale(${scale})` }} />
            <div className="absolute inset-0 cursor-default" onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
              <svg className="pointer-events-none absolute inset-0 overflow-visible" width={W * scale} height={H * scale} data-tick={tick}>
                {guides && <>
                  <rect x={W * scale * 0.05} y={H * scale * 0.05} width={W * scale * 0.9} height={H * scale * 0.9} fill="none" stroke="#fff3" strokeDasharray="4 4" />
                  <rect x={W * scale * 0.1} y={H * scale * 0.1} width={W * scale * 0.8} height={H * scale * 0.8} fill="none" stroke="#fff2" strokeDasharray="4 4" />
                </>}
                {hover && !quads.length && (hover.quad
                  ? <polygon points={pts(hover.quad)} fill="#4f9dff10" stroke="#4f9dff88" strokeDasharray="3 3" />
                  : <rect x={hover.rect.x * scale} y={hover.rect.y * scale} width={hover.rect.w * scale} height={hover.rect.h * scale} fill="#4f9dff0d" stroke="#4f9dff77" strokeDasharray="3 3" />)}
                {quads.map(({ id, q }) => {
                  const c = center(q), top = { x: (q[0].x + q[1].x) / 2, y: (q[0].y + q[1].y) / 2 };
                  const dir = { x: top.x - c.x, y: top.y - c.y }, len = Math.hypot(dir.x, dir.y) || 1;
                  const rot = { x: (top.x + (dir.x / len) * 28 / scale) * scale, y: (top.y + (dir.y / len) * 28 / scale) * scale };
                  return (
                    <g key={id}>
                      <polygon points={pts(q)} fill="none" stroke="#4f9dff" strokeWidth="1.5" />
                      <line x1={c.x * scale - 6} y1={c.y * scale} x2={c.x * scale + 6} y2={c.y * scale} stroke="#4f9dff" />
                      <line x1={c.x * scale} y1={c.y * scale - 6} x2={c.x * scale} y2={c.y * scale + 6} stroke="#4f9dff" />
                      {quads.length === 1 && <>
                        <line x1={top.x * scale} y1={top.y * scale} x2={rot.x} y2={rot.y} stroke="#4f9dff" />
                        <circle cx={rot.x} cy={rot.y} r="5" fill="#16171c" stroke="#4f9dff" className="pointer-events-auto cursor-grab" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, 'rotate', [id]); }} />
                        {q.map((p, i) => <rect key={i} x={p.x * scale - 4} y={p.y * scale - 4} width="8" height="8" fill="#16171c" stroke="#4f9dff" className="pointer-events-auto cursor-nwse-resize" onPointerDown={(e) => { e.stopPropagation(); startDrag(e, 'scale', [id]); }} />)}
                      </>}
                    </g>
                  );
                })}
              </svg>
              {hover && <div className="pointer-events-none absolute left-2 top-2 max-w-[80%] truncate rounded bg-black/70 px-1.5 py-0.5 text-[11px] text-fg">{hover.name}</div>}
            </div>
          </div>
        </div>
        {loading && <div className="absolute inset-0 grid place-items-center bg-app/40"><Loader2 className="animate-spin text-mute" /></div>}
      </div>
    </div>
  );
}
