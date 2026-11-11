import { easeFn, EASE_PRESETS } from './bezier.js';

let uid = 0;
export const newId = (p = 'id') => `${p}_${Date.now().toString(36)}${(uid++).toString(36)}${Math.random().toString(36).slice(2, 5)}`;

/** Interpolated value of a track at time t. Keys sorted by t. Ease of key i drives segment i→i+1. */
export function valueAt(keys, t, base) {
  if (!keys || !keys.length) return base;
  if (t <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].t <= t) i++;
  const a = keys[i], b = keys[i + 1];
  if (a.hold) return a.v;
  const p = (t - a.t) / (b.t - a.t || 1);
  return a.v + (b.v - a.v) * easeFn(a.ease || EASE_PRESETS.linear)(p);
}

export const sortKeys = (keys) => keys.sort((a, b) => a.t - b.t);

/** Insert or replace a key at time t (within half a frame). Mutates. */
export function upsertKey(keys, t, v, fps = 30, ease = EASE_PRESETS.easyEase) {
  const eps = 0.5 / fps;
  const k = keys.find((k) => Math.abs(k.t - t) < eps);
  if (k) { k.v = v; return k; }
  const nk = { id: newId('k'), t, v, ease: [...ease] };
  keys.push(nk); sortKeys(keys);
  return nk;
}

export const keyAt = (keys, t, fps = 30) => keys?.find((k) => Math.abs(k.t - t) < 0.5 / fps);
