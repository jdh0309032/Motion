import { newId, valueAt } from './keyframes.js';

// ---------- Parameter schemas (drive inspector UI + animation) ----------
export const TRANSFORM = [
  { key: 'x', label: 'Position X', step: 1 },
  { key: 'y', label: 'Position Y', step: 1 },
  { key: 'z', label: 'Position Z', step: 1 },
  { key: 'rotation', label: 'Rotation', step: 1, unit: '°' },
  { key: 'rotX', label: 'X Rotation', step: 1, unit: '°' },
  { key: 'rotY', label: 'Y Rotation', step: 1, unit: '°' },
  { key: 'scale', label: 'Scale', step: 1, unit: '%' },
  { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, unit: '%' },
];

const MAT = [
  { key: 'color', label: 'Color', type: 'color' },
  { key: 'size', label: 'Size', min: 1, max: 2000, step: 1 },
  { key: 'metalness', label: 'Metalness', min: 0, max: 1, step: 0.01 },
  { key: 'roughness', label: 'Roughness', min: 0, max: 1, step: 0.01 },
  { key: 'emissive', label: 'Emissive', type: 'color' },
  { key: 'emissiveIntensity', label: 'Emissive Int.', min: 0, max: 10, step: 0.05 },
  { key: 'wireframe', label: 'Wireframe', type: 'bool' },
];
const SHAPE = [
  { key: 'width', label: 'Width', min: 1, max: 8000, step: 1 },
  { key: 'height', label: 'Height', min: 1, max: 8000, step: 1 },
  { key: 'color', label: 'Fill', type: 'color' },
  { key: 'strokeWidth', label: 'Stroke', min: 0, max: 200, step: 0.5 },
  { key: 'strokeColor', label: 'Stroke Color', type: 'color' },
];

export const LAYER_TYPES = {
  text: { label: 'Text', is3D: false, content: {
    text: 'Motion', fontSize: 120, fontFamily: 'Inter, system-ui, sans-serif', fontWeight: 800, color: '#ffffff', letterSpacing: 0,
  }, params: [
    { key: 'text', label: 'Text', type: 'textarea' },
    { key: 'fontSize', label: 'Font Size', min: 4, max: 1000, step: 1 },
    { key: 'fontFamily', label: 'Font', type: 'text' },
    { key: 'fontWeight', label: 'Weight', min: 100, max: 900, step: 100 },
    { key: 'letterSpacing', label: 'Tracking', min: -50, max: 200, step: 0.5 },
    { key: 'color', label: 'Color', type: 'color' },
  ] },
  rect: { label: 'Rectangle', is3D: false, content: { width: 400, height: 240, color: '#7c8cff', radius: 24, strokeWidth: 0, strokeColor: '#ffffff' },
    params: [...SHAPE, { key: 'radius', label: 'Roundness', min: 0, max: 1000, step: 1 }] },
  ellipse: { label: 'Ellipse', is3D: false, content: { width: 300, height: 300, color: '#ff5c8a', strokeWidth: 0, strokeColor: '#ffffff' }, params: SHAPE },
  image: { label: 'Image', is3D: false, content: { assetId: null, width: 0, height: 0 }, params: [
    { key: 'assetId', label: 'Source', type: 'asset', kind: 'image' },
    { key: 'width', label: 'Width', min: 1, max: 8000, step: 1 },
    { key: 'height', label: 'Height', min: 1, max: 8000, step: 1 },
  ] },
  null: { label: 'Null Object', is3D: false, content: {}, params: [] },
  box: { label: 'Box', is3D: true, content: { color: '#5cc8ff', size: 260, metalness: 0.3, roughness: 0.35, emissive: '#000000', emissiveIntensity: 1, wireframe: false }, params: MAT },
  sphere: { label: 'Sphere', is3D: true, content: { color: '#ffb35c', size: 260, metalness: 0.1, roughness: 0.4, emissive: '#000000', emissiveIntensity: 1, wireframe: false }, params: MAT },
  torus: { label: 'Torus', is3D: true, content: { color: '#c77dff', size: 300, metalness: 0.6, roughness: 0.2, emissive: '#3a0ca3', emissiveIntensity: 1.5, wireframe: false }, params: MAT },
  model: { label: '3D Model', is3D: true, content: { assetId: null, size: 400 }, params: [
    { key: 'assetId', label: 'Source', type: 'asset', kind: 'model' },
    { key: 'size', label: 'Size', min: 1, max: 4000, step: 1 },
  ] },
};

// 2D per-layer effects, rasterised into the layer texture (exact in render output).
export const EFFECTS = {
  blur: { label: 'Gaussian Blur', params: [{ key: 'radius', label: 'Blurriness', min: 0, max: 200, step: 0.5, def: 12 }] },
  shadow: { label: 'Drop Shadow', params: [
    { key: 'color', label: 'Color', type: 'color', def: '#000000' },
    { key: 'opacity', label: 'Opacity', min: 0, max: 100, step: 1, def: 60 },
    { key: 'angle', label: 'Direction', min: 0, max: 360, step: 1, def: 135 },
    { key: 'distance', label: 'Distance', min: 0, max: 500, step: 1, def: 18 },
    { key: 'softness', label: 'Softness', min: 0, max: 200, step: 1, def: 24 },
  ] },
  tint: { label: 'Color Tint', params: [
    { key: 'color', label: 'Tint Color', type: 'color', def: '#ff3d7f' },
    { key: 'amount', label: 'Amount', min: 0, max: 100, step: 1, def: 70 },
  ] },
  glow: { label: 'Glow', params: [
    { key: 'color', label: 'Color', type: 'color', def: '#7cf6ff' },
    { key: 'radius', label: 'Radius', min: 0, max: 200, step: 1, def: 30 },
    { key: 'intensity', label: 'Intensity', min: 0, max: 5, step: 0.05, def: 1.5 },
  ] },
};

// Global Three.js post-processing stack.
export const POST = {
  bloom: { label: 'Bloom', params: [
    { key: 'strength', label: 'Strength', min: 0, max: 5, step: 0.01, def: 1.2 },
    { key: 'radius', label: 'Radius', min: 0, max: 1.5, step: 0.01, def: 0.5 },
    { key: 'threshold', label: 'Threshold', min: 0, max: 1, step: 0.01, def: 0.6 },
  ] },
  glitch: { label: 'Glitch', params: [
    { key: 'amount', label: 'Amount', min: 0, max: 1, step: 0.01, def: 0.35 },
    { key: 'blocks', label: 'Block Size', min: 2, max: 80, step: 1, def: 24 },
    { key: 'speed', label: 'Speed', min: 0, max: 60, step: 1, def: 12 },
  ] },
  chroma: { label: 'Chromatic Aberration', params: [{ key: 'amount', label: 'Offset (px)', min: 0, max: 40, step: 0.1, def: 4 }] },
  vignette: { label: 'Vignette', params: [{ key: 'amount', label: 'Amount', min: 0, max: 1.5, step: 0.01, def: 0.5 }] },
  grain: { label: 'Film Grain', params: [{ key: 'amount', label: 'Amount', min: 0, max: 0.5, step: 0.005, def: 0.06 }] },
};

const defaults = (params) => Object.fromEntries(params.map((p) => [p.key, p.def]));

// ---------- factories ----------
export function createLayer(type, project, extra = {}) {
  const def = LAYER_TYPES[type];
  const n = project.layers.filter((l) => l.type === type).length + 1;
  return {
    id: newId('L'), name: `${def.label} ${n}`, type, parent: null, visible: true, locked: false,
    inPoint: 0, outPoint: project.duration,
    props: { x: project.width / 2, y: project.height / 2, z: 0, rotation: 0, rotX: 0, rotY: 0, scale: 100, opacity: 100 },
    content: structuredClone(def.content), effects: [], tracks: {}, ...extra,
  };
}
export const createEffect = (type) => ({ id: newId('fx'), type, enabled: true, params: defaults(EFFECTS[type].params) });

export function createProject() {
  return {
    version: 1, name: 'Untitled', width: 1920, height: 1080, fps: 30, duration: 6, bg: '#0b0c14',
    layers: [],
    post: Object.fromEntries(Object.entries(POST).map(([k, d]) => [k, { enabled: k === 'bloom', ...defaults(d.params) }])),
    postTracks: {},
    audio: { assetId: null, offset: 0, volume: 1, bpm: 0, beats: [] },
  };
}

// ---------- animatable paths ----------
// 'x' → props.x · 'c.fontSize' → content.fontSize · 'fx.<id>.<key>' → effect param
export function getBase(layer, path) {
  if (path.startsWith('c.')) return layer.content[path.slice(2)];
  if (path.startsWith('fx.')) { const [, id, k] = path.split('.'); return layer.effects.find((e) => e.id === id)?.params[k]; }
  return layer.props[path];
}
export function setBase(layer, path, v) {
  if (path.startsWith('c.')) layer.content[path.slice(2)] = v;
  else if (path.startsWith('fx.')) { const [, id, k] = path.split('.'); const e = layer.effects.find((e) => e.id === id); if (e) e.params[k] = v; }
  else layer.props[path] = v;
}
export function pathLabel(layer, path) {
  if (path.startsWith('c.')) return LAYER_TYPES[layer.type].params.find((p) => p.key === path.slice(2))?.label ?? path;
  if (path.startsWith('fx.')) {
    const [, id, k] = path.split('.'); const e = layer.effects.find((e) => e.id === id);
    return e ? `${EFFECTS[e.type].label} › ${EFFECTS[e.type].params.find((p) => p.key === k)?.label}` : path;
  }
  return TRANSFORM.find((p) => p.key === path)?.label ?? path;
}

/** Layer with every animated numeric value resolved at time t. */
export function resolveLayer(layer, t) {
  const props = { ...layer.props }, content = { ...layer.content };
  const effects = layer.effects.map((e) => ({ ...e, params: { ...e.params } }));
  for (const [path, keys] of Object.entries(layer.tracks)) {
    if (!keys.length) continue;
    const v = valueAt(keys, t);
    if (path.startsWith('c.')) content[path.slice(2)] = v;
    else if (path.startsWith('fx.')) { const [, id, k] = path.split('.'); const e = effects.find((e) => e.id === id); if (e) e.params[k] = v; }
    else props[path] = v;
  }
  return { ...layer, props, content, effects };
}
export function resolvePost(project, t) {
  const post = structuredClone(project.post);
  for (const [path, keys] of Object.entries(project.postTracks || {})) {
    if (!keys.length) continue;
    const [fx, k] = path.split('.');
    if (post[fx]) post[fx][k] = valueAt(keys, t);
  }
  return post;
}

/** Ancestors chain check — prevents parenting cycles. */
export function wouldCycle(layers, childId, parentId) {
  let p = parentId;
  const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
  while (p) { if (p === childId) return true; p = byId[p]?.parent; }
  return false;
}
