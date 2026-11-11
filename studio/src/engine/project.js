import { newId, valueAt, upsertKey, keyAt, sortKeys } from './keyframes.js';

// ───────── property schemas (drive the inspector, timeline rows and animation paths) ─────────
export const TRANSFORM = [
  { key: 'x', label: 'Position X', step: 1, group: 'P' },
  { key: 'y', label: 'Position Y', step: 1, group: 'P' },
  { key: 'z', label: 'Position Z', step: 1, group: 'P' },
  { key: 'scale', label: 'Scale', step: 0.5, unit: '%', group: 'S' },
  { key: 'scaleX', label: 'Scale X', step: 0.5, unit: '%', group: 'S' },
  { key: 'scaleY', label: 'Scale Y', step: 0.5, unit: '%', group: 'S' },
  { key: 'rotation', label: 'Rotation', step: 0.5, unit: '°', group: 'R' },
  { key: 'rotX', label: 'X Rotation', step: 0.5, unit: '°', group: 'R' },
  { key: 'rotY', label: 'Y Rotation', step: 0.5, unit: '°', group: 'R' },
  { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, unit: '%', group: 'T' },
];
export const BASE_PROPS = { x: 0, y: 0, z: 0, rotation: 0, rotX: 0, rotY: 0, scale: 100, scaleX: 100, scaleY: 100, opacity: 100 };

const SHAPE = [
  { key: 'width', label: 'Width', min: 1, max: 8000, step: 1 },
  { key: 'height', label: 'Height', min: 1, max: 8000, step: 1 },
  { key: 'color', label: 'Fill', type: 'color' },
  { key: 'strokeWidth', label: 'Stroke Width', min: 0, max: 200, step: 0.5 },
  { key: 'strokeColor', label: 'Stroke Color', type: 'color' },
];
export const LAYER_TYPES = {
  element: { label: 'HTML Element', icon: 'Code2', content: {}, params: [] },
  text: { label: 'Text', icon: 'Type', content: { text: 'New Text', fontSize: 96, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 800, color: '#ffffff', letterSpacing: 0, align: 'center' }, params: [
    { key: 'text', label: 'Source Text', type: 'textarea' },
    { key: 'fontFamily', label: 'Font', type: 'text' },
    { key: 'fontSize', label: 'Font Size', min: 4, max: 1000, step: 1 },
    { key: 'fontWeight', label: 'Weight', min: 100, max: 900, step: 100 },
    { key: 'letterSpacing', label: 'Tracking', min: -50, max: 200, step: 0.5 },
    { key: 'color', label: 'Fill Color', type: 'color' },
  ] },
  rect: { label: 'Rectangle', icon: 'Square', content: { width: 480, height: 280, color: '#7c8cff', radius: 24, strokeWidth: 0, strokeColor: '#ffffff' }, params: [...SHAPE, { key: 'radius', label: 'Roundness', min: 0, max: 2000, step: 1 }] },
  ellipse: { label: 'Ellipse', icon: 'Circle', content: { width: 320, height: 320, color: '#ff5c8a', strokeWidth: 0, strokeColor: '#ffffff' }, params: SHAPE },
  solid: { label: 'Solid', icon: 'RectangleHorizontal', content: { width: 1920, height: 1080, color: '#1d1f2e', radius: 0, strokeWidth: 0, strokeColor: '#000000' }, params: SHAPE.slice(0, 3) },
  image: { label: 'Image', icon: 'Image', content: { assetId: null, width: 0, height: 0 }, params: [
    { key: 'assetId', label: 'Source', type: 'asset', kind: 'image' },
    { key: 'width', label: 'Width', min: 1, max: 8000, step: 1 },
    { key: 'height', label: 'Height', min: 1, max: 8000, step: 1 },
  ] },
  null: { label: 'Null Object', icon: 'Crosshair', content: {}, params: [] },
};

// ───────── effects (all rendered by the runtime; every numeric param is keyframeable) ─────────
export const EFFECTS = {
  blur: { label: 'Gaussian Blur', cat: 'Blur & Sharpen', params: [{ key: 'radius', label: 'Blurriness', min: 0, max: 200, step: 0.5, def: 12 }] },
  shadow: { label: 'Drop Shadow', cat: 'Perspective', params: [
    { key: 'color', label: 'Shadow Color', type: 'color', def: '#000000' },
    { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, def: 60 },
    { key: 'angle', label: 'Direction', min: 0, max: 360, step: 1, def: 135 },
    { key: 'distance', label: 'Distance', min: 0, max: 500, step: 1, def: 18 },
    { key: 'softness', label: 'Softness', min: 0, max: 200, step: 1, def: 24 },
  ] },
  glow: { label: 'Glow', cat: 'Stylize', params: [
    { key: 'color', label: 'Glow Color', type: 'color', def: '#7cf6ff' },
    { key: 'radius', label: 'Glow Radius', min: 0, max: 200, step: 1, def: 24 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 5, step: 0.05, def: 1.5 },
  ] },
  rgbSplit: { label: 'RGB Split', cat: 'Stylize', params: [
    { key: 'amount', label: 'Offset', min: 0, max: 80, step: 0.5, def: 6 },
    { key: 'angle', label: 'Angle', min: 0, max: 360, step: 1, def: 0 },
  ] },
  tint: { label: 'Tint', cat: 'Color Correction', params: [
    { key: 'color', label: 'Map White To', type: 'color', def: '#ff3d7f' },
    { key: 'amount', label: 'Amount to Tint', min: 0, max: 100, step: 1, def: 100 },
  ] },
  color: { label: 'Brightness & Color', cat: 'Color Correction', params: [
    { key: 'brightness', label: 'Brightness', min: 0, max: 300, step: 1, def: 100 },
    { key: 'contrast', label: 'Contrast', min: 0, max: 300, step: 1, def: 100 },
    { key: 'saturation', label: 'Saturation', min: 0, max: 300, step: 1, def: 100 },
    { key: 'hue', label: 'Hue', min: -180, max: 180, step: 1, def: 0 },
  ] },
  vignette: { label: 'Vignette', cat: 'Comp', compOnly: true, params: [{ key: 'amount', label: 'Amount', min: 0, max: 1.5, step: 0.01, def: 0.6 }] },
  grain: { label: 'Film Grain', cat: 'Comp', compOnly: true, params: [{ key: 'amount', label: 'Intensity', min: 0, max: 0.6, step: 0.01, def: 0.12 }] },
};
const defaults = (params) => Object.fromEntries(params.map((p) => [p.key, p.def]));
export const createEffect = (type) => ({ id: newId('fx'), type, enabled: true, params: defaults(EFFECTS[type].params) });

export const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
export const LABEL_COLORS = ['#e0636f', '#e8b04b', '#9ad45d', '#4fc2c9', '#7c8cff', '#c77dff', '#ff7ec8', '#9aa0b4'];

// ───────── factories ─────────
export const BLANK_SOURCE = (w, h, bg = '#0b0c14') => `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:${bg}}</style></head>
<body></body></html>`;

export function createProject(over = {}) {
  const p = { version: 1, name: 'Untitled', width: 1920, height: 1080, fps: 30, duration: 6, perspective: 1600, source: null,
    layers: [], comp: { effects: [], tracks: {}, loops: {} }, audio: { assetId: null, offset: 0, volume: 1, bpm: 0, beats: [] }, markers: [], ...over };
  if (!p.source) p.source = BLANK_SOURCE(p.width, p.height);
  return p;
}

export function createLayer(type, project, extra = {}) {
  const def = LAYER_TYPES[type];
  const n = project.layers.filter((l) => l.type === type).length + 1;
  return {
    id: newId('L'), name: `${def.label} ${n}`, type, selector: null, parent: null, visible: true, locked: false,
    inPoint: 0, outPoint: project.duration, blend: 'normal', label: LABEL_COLORS[project.layers.length % LABEL_COLORS.length],
    props: { ...BASE_PROPS, x: project.width / 2, y: project.height / 2 },
    content: structuredClone(def.content), effects: [], tracks: {}, loops: {}, ...extra,
  };
}

/** Turn a runtime analysis entry (or a picked element) into an element layer. */
export function elementLayer(entry, project, i = project.layers.length) {
  return {
    id: newId('L'), name: entry.name, type: 'element', selector: entry.selector, parent: null, visible: true, locked: false,
    inPoint: 0, outPoint: project.duration, blend: 'normal', label: LABEL_COLORS[i % LABEL_COLORS.length], sources: entry.sources || [],
    props: { ...BASE_PROPS, ...entry.props }, content: {}, effects: [], tracks: entry.tracks || {}, loops: entry.loops || {},
  };
}

// ───────── animatable paths ─────────
// 'x' → props.x · 'c.fontSize' → content · 'fx.<id>.<key>' → effect param · 'css.<prop>' → raw CSS track
export function getBase(target, path) {
  if (path.startsWith('c.')) return target.content?.[path.slice(2)];
  if (path.startsWith('fx.')) { const [, id, k] = path.split('.'); return target.effects.find((e) => e.id === id)?.params[k]; }
  if (path.startsWith('css.')) return target.tracks?.[path]?.[0]?.v;
  return target.props?.[path];
}
export function setBase(target, path, v) {
  if (path.startsWith('c.')) target.content[path.slice(2)] = v;
  else if (path.startsWith('fx.')) { const [, id, k] = path.split('.'); const e = target.effects.find((e) => e.id === id); if (e) e.params[k] = v; }
  else if (!path.startsWith('css.')) target.props[path] = v;
}
export function getValue(target, path, t) {
  const keys = target.tracks?.[path];
  return keys?.length ? valueAt(keys, t, target.loops?.[path]) : getBase(target, path);
}
export function paramDef(target, path) {
  if (path.startsWith('c.')) return LAYER_TYPES[target.type]?.params.find((p) => p.key === path.slice(2));
  if (path.startsWith('fx.')) { const [, id, k] = path.split('.'); const e = target.effects.find((e) => e.id === id); return e && EFFECTS[e.type].params.find((p) => p.key === k); }
  if (path.startsWith('css.')) return { key: path, label: path.slice(4), type: 'css' };
  return TRANSFORM.find((p) => p.key === path);
}
export function pathLabel(target, path) {
  if (path.startsWith('fx.')) { const [, id] = path.split('.'); const e = target.effects.find((e) => e.id === id); return e ? `${EFFECTS[e.type].label} › ${paramDef(target, path)?.label}` : path; }
  return paramDef(target, path)?.label ?? path;
}

/** AE semantics: animated property → key at t; static property → change base value. */
export function setValue(target, path, v, t, fps) {
  const keys = target.tracks?.[path];
  if (keys?.length) upsertKey(keys, t, v, fps);
  else setBase(target, path, v);
}
export function toggleStopwatch(target, path, t, fps) {
  target.tracks ||= {};
  if (target.tracks[path]?.length) { const v = getValue(target, path, t); delete target.tracks[path]; delete target.loops?.[path]; setBase(target, path, v); }
  else target.tracks[path] = [{ id: newId('k'), t: Math.round(t * fps) / fps, v: getBase(target, path), ease: [0.33, 0, 0.67, 1] }];
}
export function addKeyHere(target, path, t, fps) {
  target.tracks ||= {};
  const keys = (target.tracks[path] ||= []);
  const k = keyAt(keys, t, fps);
  if (k) { keys.splice(keys.indexOf(k), 1); if (!keys.length) { delete target.tracks[path]; setBase(target, path, k.v); } return; }
  upsertKey(keys, t, getValue(target, path, t) ?? getBase(target, path), fps);
}

/** All animatable paths of a target, grouped for the timeline. */
export function propertyGroups(target, isComp = false) {
  const g = [];
  if (!isComp) g.push({ name: 'Transform', paths: TRANSFORM.filter((p) => p.key !== 'scaleX' && p.key !== 'scaleY' || target.tracks?.[p.key] || target.props[p.key] !== 100).map((p) => p.key) });
  const cp = (LAYER_TYPES[target.type]?.params || []).filter((p) => !p.type).map((p) => 'c.' + p.key);
  if (cp.length) g.push({ name: LAYER_TYPES[target.type].label, paths: cp });
  for (const e of target.effects || []) g.push({ name: EFFECTS[e.type].label, fx: e.id, paths: EFFECTS[e.type].params.filter((p) => !p.type).map((p) => `fx.${e.id}.${p.key}`) });
  const css = Object.keys(target.tracks || {}).filter((p) => p.startsWith('css.'));
  if (css.length) g.push({ name: 'CSS', paths: css });
  return g;
}

export function wouldCycle(layers, childId, parentId) {
  const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  for (let p = parentId; p; p = byId[p]?.parent) if (p === childId) return true;
  return false;
}

// ───────── animation presets (Effects & Presets › Animation Presets) ─────────
const E = { easy: [0.33, 0, 0.67, 1], out: [0.16, 1, 0.3, 1], back: [0.34, 1.56, 0.64, 1], lin: [0, 0, 1, 1] };
export const PRESETS = {
  fadeIn: { label: 'Fade In', keys: { opacity: [[0, 0, E.easy], [0.6, 100]] } },
  fadeOut: { label: 'Fade Out', keys: { opacity: [[0, 100, E.easy], [0.6, 0]] } },
  popIn: { label: 'Pop In', keys: { scale: [[0, 0, E.back], [0.55, '@']], opacity: [[0, 0, E.lin], [0.2, '@']] } },
  slideUp: { label: 'Slide Up', keys: { y: [[0, '+120', E.out], [0.8, '@']], opacity: [[0, 0, E.easy], [0.5, '@']] } },
  slideLeft: { label: 'Slide In Left', keys: { x: [[0, '-300', E.out], [0.8, '@']], opacity: [[0, 0, E.easy], [0.5, '@']] } },
  spinIn: { label: 'Spin In', keys: { rotation: [[0, '-180', E.out], [0.9, '@']], scale: [[0, 0, E.out], [0.9, '@']] } },
  blurIn: { label: 'Blur In', fx: 'blur', keys: { 'fx.radius': [[0, 40, E.out], [0.8, 0]], opacity: [[0, 0, E.easy], [0.5, '@']] } },
  flip3D: { label: '3D Flip In', keys: { rotY: [[0, '-90', E.out], [0.9, '@']], opacity: [[0, 0, E.lin], [0.3, '@']] } },
  wiggle: { label: 'Wiggle (Position)', wiggle: true },
};
export function applyPreset(layer, name, t, fps) {
  const pr = PRESETS[name];
  layer.tracks ||= {};
  if (pr.wiggle) {
    let s = 1234567;
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1;
    for (const p of ['x', 'y']) {
      const base = getValue(layer, p, t), keys = (layer.tracks[p] ||= []);
      for (let i = 0; i <= 12; i++) upsertKey(keys, t + i / 6, base + (i === 0 || i === 12 ? 0 : rnd() * 24), fps, E.easy);
    }
    return;
  }
  let fxId = null;
  if (pr.fx) { const fx = createEffect(pr.fx); fxId = fx.id; layer.effects.push(fx); }
  for (const [p0, list] of Object.entries(pr.keys)) {
    const path = p0.startsWith('fx.') ? `fx.${fxId}.${p0.slice(3)}` : p0;
    const cur = getValue(layer, path, t + list[list.length - 1][0]);
    const keys = (layer.tracks[path] ||= []);
    for (const [dt, v, ease] of list) {
      const val = v === '@' ? cur : typeof v === 'string' ? cur + parseFloat(v) : v;
      const k = upsertKey(keys, t + dt, val, fps);
      k.ease = [...(ease || E.easy)];
    }
    sortKeys(keys);
  }
}
