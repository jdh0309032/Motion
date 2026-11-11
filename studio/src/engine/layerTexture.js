// Rasterises a 2D layer (content + effect stack) into a canvas. Deterministic → exact renders.
const MAX = 4096;

function contentSize(layer, img, measure) {
  const c = layer.content;
  if (layer.type === 'text') return measure(c);
  if (layer.type === 'image') {
    if (!img) return { w: 2, h: 2 };
    return { w: c.width || img.naturalWidth, h: c.height || img.naturalHeight };
  }
  if (layer.type === 'null') return { w: 0, h: 0 };
  const sw = c.strokeWidth || 0;
  return { w: c.width + sw, h: c.height + sw };
}

function effectPad(effects) {
  let p = 0;
  for (const e of effects) {
    if (!e.enabled) continue;
    const q = e.params;
    if (e.type === 'blur') p += q.radius * 2.5;
    if (e.type === 'shadow') p += q.distance + q.softness * 1.5;
    if (e.type === 'glow') p += q.radius * 2;
  }
  return Math.ceil(p);
}

const font = (c) => `${c.fontWeight} ${c.fontSize}px ${c.fontFamily}`;
let mctx;
function measureText(c) {
  mctx ||= document.createElement('canvas').getContext('2d');
  mctx.font = font(c);
  mctx.letterSpacing = `${c.letterSpacing || 0}px`;
  const lines = String(c.text).split('\n');
  const w = Math.max(1, ...lines.map((l) => mctx.measureText(l).width));
  return { w: Math.ceil(w + Math.abs(c.letterSpacing || 0)), h: Math.ceil(lines.length * c.fontSize * 1.2) };
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function drawContent(ctx, layer, img, w, h) {
  const c = layer.content;
  ctx.save();
  if (layer.type === 'text') {
    ctx.font = font(c); ctx.letterSpacing = `${c.letterSpacing || 0}px`;
    ctx.fillStyle = c.color; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const lines = String(c.text).split('\n');
    const lh = c.fontSize * 1.2;
    lines.forEach((l, i) => ctx.fillText(l, w / 2 + (c.letterSpacing || 0) / 2, h / 2 + (i - (lines.length - 1) / 2) * lh));
  } else if (layer.type === 'image') {
    if (img) ctx.drawImage(img, 0, 0, w, h);
  } else if (layer.type === 'rect' || layer.type === 'ellipse') {
    const sw = c.strokeWidth || 0;
    ctx.beginPath();
    if (layer.type === 'rect') ctx.roundRect(sw / 2, sw / 2, c.width, c.height, Math.min(c.radius || 0, c.width / 2, c.height / 2));
    else ctx.ellipse(w / 2, h / 2, c.width / 2, c.height / 2, 0, 0, Math.PI * 2);
    ctx.fillStyle = c.color; ctx.fill();
    if (sw > 0) { ctx.lineWidth = sw; ctx.strokeStyle = c.strokeColor; ctx.stroke(); }
  }
  ctx.restore();
}

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

/**
 * @returns {{canvas, w, h}} canvas plus its size in composition pixels (incl. effect padding).
 */
export function rasterizeLayer(layer, img, quality = 2) {
  const { w, h } = contentSize(layer, img, measureText);
  const pad = effectPad(layer.effects);
  const W = w + pad * 2, H = h + pad * 2;
  if (W <= 0 || H <= 0) return null;
  const res = Math.min(quality, MAX / W, MAX / H);
  let cur = mk(Math.max(1, Math.round(W * res)), Math.max(1, Math.round(H * res)));
  let ctx = cur.getContext('2d');
  ctx.scale(res, res); ctx.translate(pad, pad);
  drawContent(ctx, layer, img, w, h);

  for (const e of layer.effects) {
    if (!e.enabled) continue;
    const q = e.params;
    if (e.type === 'tint') {
      ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-atop';
      ctx.fillStyle = hexA(q.color, q.amount / 100); ctx.fillRect(0, 0, cur.width, cur.height);
      ctx.restore();
      continue;
    }
    const next = mk(cur.width, cur.height), n = next.getContext('2d');
    if (e.type === 'blur') {
      n.filter = `blur(${q.radius * res}px)`; n.drawImage(cur, 0, 0);
    } else if (e.type === 'shadow') {
      const a = ((q.angle - 90) * Math.PI) / 180;
      n.shadowColor = hexA(q.color, q.opacity / 100); n.shadowBlur = q.softness * res;
      n.shadowOffsetX = Math.cos(a) * q.distance * res; n.shadowOffsetY = Math.sin(a) * q.distance * res;
      n.drawImage(cur, 0, 0);
    } else if (e.type === 'glow') {
      n.shadowColor = q.color; n.shadowBlur = q.radius * res;
      let k = q.intensity;
      while (k > 0) { n.globalAlpha = Math.min(1, k); n.drawImage(cur, 0, 0); k -= 1; }
      n.shadowColor = 'transparent'; n.globalAlpha = 1; n.drawImage(cur, 0, 0);
    }
    cur = next; ctx = n;
  }
  return { canvas: cur, w: W, h: H };
}

export const layerTextureKey = (layer, imgReady) =>
  JSON.stringify([layer.type, layer.content, layer.effects, imgReady]);
