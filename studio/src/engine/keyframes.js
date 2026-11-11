import { easeFn } from './bezier.js';

let uid = 0;
export const newId = (p = 'id') => `${p}${Date.now().toString(36)}${(uid++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;
/** Same semantics as the runtime: numbers lerp; strings with identical number templates lerp; else step. */
export function lerpValue(a, b, p) {
  if (typeof a === 'number' && typeof b === 'number') return a + (b - a) * p;
  const sa = String(a), sb = String(b);
  const na = sa.match(NUM), nb = sb.match(NUM);
  if (!na || !nb || na.length !== nb.length || sa.replace(NUM, '#') !== sb.replace(NUM, '#')) return p < 1 ? a : b;
  let i = 0;
  const isColor = /^rgba?\(/.test(sa);
  return sa.replace(NUM, () => { const v = +na[i] + (nb[i] - na[i]) * p; i++; return isColor && i <= 3 ? Math.round(v) : +v.toFixed(4); });
}

/** Must stay identical to motion-runtime.js valueAt (checked by test). */
export function valueAt(keys, t, loop) {
  const n = keys?.length; if (!n) return undefined;
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

export const sortKeys = (keys) => keys.sort((a, b) => a.t - b.t);
export const keyAt = (keys, t, fps = 30) => keys?.find((k) => Math.abs(k.t - t) < 0.5 / fps);

/** Insert or replace a key at time t (within half a frame). Mutates keys. */
export function upsertKey(keys, t, v, fps = 30, ease = [0.33, 0, 0.67, 1]) {
  const k = keyAt(keys, t, fps);
  if (k) { k.v = v; return k; }
  const nk = { id: newId('k'), t: Math.round(t * fps) / fps, v, ease: [...ease] };
  keys.push(nk); sortKeys(keys);
  return nk;
}
