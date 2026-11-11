// Audio: decoding, waveform peaks, onset/beat detection, synced preview playback.
let ctx;
const ac = () => (ctx ||= new AudioContext());
const buffers = new Map(); // assetId → AudioBuffer

export async function decode(asset) {
  if (buffers.has(asset.id)) return buffers.get(asset.id);
  const res = await fetch(asset.url);
  const buf = await ac().decodeAudioData(await res.arrayBuffer());
  buffers.set(asset.id, buf);
  return buf;
}
export const bufferOf = (id) => buffers.get(id);

/** Min/max peaks per bucket (for drawing). */
export function peaks(buf, buckets) {
  const ch = buf.getChannelData(0), n = ch.length, out = new Float32Array(buckets * 2), step = n / buckets;
  for (let b = 0; b < buckets; b++) {
    let lo = 1, hi = -1;
    for (let i = Math.floor(b * step), e = Math.min(n, Math.floor((b + 1) * step)); i < e; i += 4) { const v = ch[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    out[b * 2] = lo; out[b * 2 + 1] = hi;
  }
  return out;
}

/** RMS envelope at `rate` Hz (0..1). Used by "Audio → Keyframes". */
export function envelope(buf, rate = 30) {
  const ch = buf.getChannelData(0), sr = buf.sampleRate, win = Math.floor(sr / rate), out = [];
  for (let i = 0; i < ch.length; i += win) { let s = 0; const e = Math.min(ch.length, i + win); for (let j = i; j < e; j++) s += ch[j] * ch[j]; out.push(Math.sqrt(s / (e - i))); }
  const mx = Math.max(1e-6, ...out);
  return out.map((v) => v / mx);
}

/** Onset detection (energy flux + adaptive threshold) and tempo estimate (autocorrelation). */
export function detectBeats(buf) {
  const sr = buf.sampleRate, hop = 512, ch = buf.getChannelData(0);
  const e = [];
  for (let i = 0; i + 1024 < ch.length; i += hop) { let s = 0; for (let j = i; j < i + 1024; j++) s += ch[j] * ch[j]; e.push(Math.log(1e-9 + s)); }
  const flux = e.map((v, i) => (i ? Math.max(0, v - e[i - 1]) : 0));
  const W = Math.round((sr / hop) * 0.5), onsets = [];
  let last = -1e9;
  for (let i = 1; i < flux.length - 1; i++) {
    let m = 0, c = 0; for (let j = Math.max(0, i - W); j < Math.min(flux.length, i + W); j++) { m += flux[j]; c++; } m /= c;
    let sd = 0; for (let j = Math.max(0, i - W); j < Math.min(flux.length, i + W); j++) sd += (flux[j] - m) ** 2; sd = Math.sqrt(sd / c);
    const t = (i * hop + 512) / sr; // centre of the 1024-sample window
    if (flux[i] > m + 1.5 * sd && flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] && t - last > 0.18) { onsets.push(+t.toFixed(3)); last = t; }
  }
  // tempo: autocorrelation of flux in 60–180 BPM
  const fr = sr / hop; let best = 0, bpm = 0;
  for (let b = 60; b <= 180; b++) {
    const lag = Math.round((60 / b) * fr); let s = 0;
    for (let i = lag; i < flux.length; i++) s += flux[i] * flux[i - lag];
    if (s > best) { best = s; bpm = b; }
  }
  return { onsets, bpm };
}
export function beatGrid(bpm, duration, phase = 0) {
  if (!bpm) return [];
  const out = []; for (let t = phase; t < duration; t += 60 / bpm) out.push(+t.toFixed(4)); return out;
}

let src = null, gain = null;
export function playAudio(asset, compTime, offset = 0, volume = 1) {
  stopAudio();
  const buf = asset && buffers.get(asset.id); if (!buf) return;
  const c = ac(); if (c.state === 'suspended') c.resume();
  src = c.createBufferSource(); src.buffer = buf;
  gain = c.createGain(); gain.gain.value = volume;
  src.connect(gain).connect(c.destination);
  const at = compTime - offset;
  if (at >= 0) src.start(0, at); else src.start(c.currentTime - at, 0);
}
export function stopAudio() { try { src?.stop(); } catch (e) {} src = null; }
