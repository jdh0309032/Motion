// High-level editor actions (used by menus, panels and shortcuts).
import { useStore, draftTarget, targetOf } from '../store.js';
import { createProject, createLayer, elementLayer, createEffect, applyPreset, setValue, getValue, EFFECTS, LAYER_TYPES, wouldCycle } from './project.js';
import { parseDocument, guessSize, analyzeSource, exportDocument, runtimeProject } from './document.js';
import { newId, sortKeys } from './keyframes.js';
import { decode, detectBeats, envelope, bufferOf } from './audio.js';

const S = () => useStore.getState();
const readAs = (file, how) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r[how](file); });

export async function importHtmlText(text, name = 'Untitled') {
  const parsed = parseDocument(text);
  if (parsed) { S().loadProject(parsed.project, parsed.assets); for (const a of Object.values(parsed.assets)) if (a.kind === 'audio') decode(a).catch(() => {}); S().toast(`프로젝트 열기: ${parsed.project.name}`); return; }
  const size = guessSize(text);
  S().setBusy('애니메이션 분석 중… (CSS · Web Animations · GSAP → 키프레임)');
  try {
    const res = await analyzeSource(text, { ...size, fps: 30, maxDuration: 30 });
    const project = createProject({ name: name.replace(/\.html?$/i, ''), ...size, source: text, duration: Math.max(3, res.duration), procedural: res.procedural });
    project.layers = res.layers.map((l, i) => elementLayer(l, project, i)).reverse();
    S().loadProject(project, {});
    const keys = project.layers.reduce((n, l) => n + Object.values(l.tracks).reduce((a, k) => a + k.length, 0), 0);
    S().toast(`가져오기 완료: 레이어 ${project.layers.length}개 · 키프레임 ${keys}개${res.procedural ? ' · 스크립트(캔버스/WebGL) 감지' : ''}`);
  } catch (e) { console.error(e); S().toast('분석 실패: ' + e.message); }
  finally { S().setBusy(null); }
}

export async function importFiles(files) {
  for (const f of files) {
    if (/\.html?$/i.test(f.name)) { await importHtmlText(await f.text(), f.name); continue; }
    const kind = f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : null;
    if (!kind) { S().toast('지원하지 않는 파일: ' + f.name); continue; }
    const url = await readAs(f, 'readAsDataURL');
    const asset = { id: newId('a'), name: f.name, kind, url, meta: {} };
    if (kind === 'image') { const img = new Image(); img.src = url; await img.decode().catch(() => {}); asset.meta = { width: img.naturalWidth, height: img.naturalHeight }; }
    if (kind === 'audio') { try { const b = await decode(asset); asset.meta = { duration: b.duration }; } catch (e) { S().toast('오디오 디코딩 실패'); continue; } }
    S().addAsset(asset);
    if (kind === 'audio') addAudioLayer(null, f.name, asset.id);
    S().toast(`에셋 추가: ${f.name}`);
  }
}

export function newProject(over) { S().loadProject(createProject(over), {}); }

export function addLayer(type, extra = {}) {
  let id;
  S().mutate((d) => {
    const l = createLayer(type, d, extra);
    l.inPoint = 0; l.outPoint = d.duration;
    d.layers.unshift(l); id = l.id;
  }, { structure: true });
  S().select({ layers: [id], keys: [] });
  return id;
}
export function addImageLayer(assetId, at) {
  const a = S().assets[assetId]; if (!a) return;
  return addLayer('image', { name: a.name, content: { assetId, width: a.meta.width, height: a.meta.height }, ...(at ? { props: { ...createLayer('image', S().project).props, x: at.x, y: at.y } } : {}) });
}
export function addElementLayer(desc) {
  const exists = S().project.layers.find((l) => l.selector === desc.selector);
  if (exists) { S().select({ layers: [exists.id] }); return exists.id; }
  let id;
  S().mutate((d) => { const l = elementLayer(desc, d); d.layers.unshift(l); id = l.id; }, { structure: true });
  S().select({ layers: [id], keys: [] });
  return id;
}
export function deleteSelection() {
  const { sel } = S();
  if (sel.keys.length) {
    S().mutate((d) => {
      for (const ref of sel.keys) {
        const [tid, path, kid] = ref.split('|'), t = draftTarget(d, tid), ks = t?.tracks?.[path];
        if (!ks) continue;
        const i = ks.findIndex((k) => k.id === kid);
        if (i >= 0) { const [k] = ks.splice(i, 1); if (!ks.length) { delete t.tracks[path]; if (!path.startsWith('css.')) setValue(t, path, k.v, 0, d.fps); } }
      }
    });
    S().select({ keys: [] });
  } else if (sel.layers.length) {
    S().mutate((d) => { d.layers = d.layers.filter((l) => !sel.layers.includes(l.id)); d.layers.forEach((l) => { if (sel.layers.includes(l.parent)) l.parent = null; }); }, { structure: true });
    S().select({ layers: [] });
  }
}
export function duplicateLayers() {
  const ids = S().sel.layers; const out = [];
  S().mutate((d) => {
    for (const id of ids) {
      const i = d.layers.findIndex((l) => l.id === id); if (i < 0 || d.layers[i].selector) continue;
      const c = structuredClone(d.layers[i]); c.id = newId('L'); c.name += ' copy';
      c.effects.forEach((e) => { const old = e.id; e.id = newId('fx'); for (const p of Object.keys(c.tracks)) if (p.startsWith(`fx.${old}.`)) { c.tracks[p.replace(old, e.id)] = c.tracks[p]; delete c.tracks[p]; } });
      d.layers.splice(i, 0, c); out.push(c.id);
    }
  }, { structure: true });
  if (out.length) S().select({ layers: out });
}
export function moveLayer(id, dir) {
  if (S().project.layers.find((l) => l.id === id)?.selector) S().toast('HTML 요소 레이어의 쌓임 순서는 원본 문서 순서를 따릅니다 (새로 만든 레이어만 이동)');
  S().mutate((d) => { const i = d.layers.findIndex((l) => l.id === id), j = i + dir; if (i < 0 || j < 0 || j >= d.layers.length) return; [d.layers[i], d.layers[j]] = [d.layers[j], d.layers[i]]; }, { structure: true });
}

export function addEffect(type, targetIds) {
  const ids = targetIds?.length ? targetIds : S().sel.layers.length && !EFFECTS[type].compOnly ? S().sel.layers : ['comp'];
  S().mutate((d) => { for (const id of ids) draftTarget(d, id)?.effects.push(createEffect(type)); });
  S().toast(`${EFFECTS[type].label} 적용 → ${ids.includes('comp') ? '컴포지션' : `레이어 ${ids.length}개`}`);
}
export function removeEffect(tid, fxId) {
  S().mutate((d) => { const t = draftTarget(d, tid); t.effects = t.effects.filter((e) => e.id !== fxId); for (const p of Object.keys(t.tracks)) if (p.startsWith(`fx.${fxId}.`)) delete t.tracks[p]; });
}
export function presetToSelection(name) {
  const { sel, time } = S();
  if (!sel.layers.length) return S().toast('먼저 레이어를 선택하세요');
  S().mutate((d) => { for (const id of sel.layers) applyPreset(draftTarget(d, id), name, time, d.fps); }, { structure: true });
}

/** Parent with AE semantics: the child keeps its current look (runtime computes compensation). */
export function setParent(childId, parentId, rt) {
  const P = S().project;
  if (parentId && wouldCycle(P.layers, childId, parentId)) return S().toast('순환 부모 관계는 만들 수 없습니다');
  const np = rt?.reparentProps(childId, parentId || null);
  const t = S().time;
  S().mutate((d) => {
    const l = draftTarget(d, childId); if (!l) return;
    if (np) {
      const shift = (k, f) => { if (l.tracks[k]?.length) l.tracks[k].forEach((key) => (key.v = f(key.v))); else l.props[k] = f(getValue(l, k, t)); };
      for (const k of ['x', 'y', 'z', 'rotation', 'rotX', 'rotY']) { const dv = np[k] - getValue(l, k, t); shift(k, (v) => +(v + dv).toFixed(4)); }
      const cur = getValue(l, 'scale', t) * ((l.props.scaleX ?? 100) / 100);
      if (cur > 1e-6) { const r = np.sx / cur; shift('scale', (v) => +(v * r).toFixed(4)); }
    }
    l.parent = parentId || null;
  }, { structure: true });
}

export function saveProject() {
  if (S().project.workspace) return saveWorkspace();
  const { project, assets } = S();
  const html = exportDocument(project, assets);
  download(new Blob([html], { type: 'text/html' }), `${project.name || 'motion'}.motion.html`);
  S().toast('저장 완료 (.motion.html — 브라우저에서 바로 재생, 에디터로 다시 열기, 렌더 가능)');
}
export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

// ───────── keyframe ops ─────────
export function setEaseSelected(ease, hold = false) {
  const { sel } = S(); if (!sel.keys.length) return S().toast('키프레임을 선택하세요');
  S().mutate((d) => { for (const ref of sel.keys) { const [tid, path, kid] = ref.split('|'); const k = draftTarget(d, tid)?.tracks?.[path]?.find((x) => x.id === kid); if (k) { k.ease = [...ease]; if (hold) k.hold = true; else delete k.hold; } } });
}
let clip = null;
export function copyKeys() {
  const { sel, project } = S(); if (!sel.keys.length) return;
  const items = sel.keys.map((r) => { const [tid, path, kid] = r.split('|'); const k = targetOf(project, tid)?.tracks?.[path]?.find((x) => x.id === kid); return k && { tid, path, k }; }).filter(Boolean);
  const t0 = Math.min(...items.map((i) => i.k.t));
  clip = items.map((i) => ({ ...i, dt: i.k.t - t0 }));
  S().toast(`키프레임 ${clip.length}개 복사`);
}
export function pasteKeys() {
  if (!clip) return;
  const { time, sel } = S(); const target = sel.layers.length === 1 ? sel.layers[0] : null;
  const refs = [];
  S().mutate((d) => {
    for (const c of clip) {
      const t = draftTarget(d, target && clip.every((x) => x.tid === clip[0].tid) ? target : c.tid); if (!t) continue;
      t.tracks ||= {}; const ks = (t.tracks[c.path] ||= []);
      const nk = { ...structuredClone(c.k), id: newId('k'), t: +(time + c.dt).toFixed(4) };
      const dup = ks.findIndex((k) => Math.abs(k.t - nk.t) < 1e-3); if (dup >= 0) ks.splice(dup, 1);
      ks.push(nk); sortKeys(ks); refs.push(`${t.id || 'comp'}|${c.path}|${nk.id}`);
    }
  });
  S().select({ keys: refs });
}
export function snapKeysToBeats() {
  const { sel, project } = S(); const beats = project.audio.beats; if (!beats?.length) return S().toast('먼저 비트를 감지하세요');
  S().mutate((d) => { for (const r of sel.keys) { const [tid, path, kid] = r.split('|'); const ks = draftTarget(d, tid)?.tracks?.[path]; const k = ks?.find((x) => x.id === kid); if (!k) continue; k.t = beats.reduce((a, b) => (Math.abs(b - k.t) < Math.abs(a - k.t) ? b : a)); sortKeys(ks); } });
}
export function pulseOnBeats(path = 'scale', amount = 12) {
  const { sel, project } = S(); const beats = project.audio.beats;
  if (!beats?.length) return S().toast('먼저 비트를 감지하세요');
  if (!sel.layers.length) return S().toast('레이어를 선택하세요');
  S().mutate((d) => {
    for (const id of sel.layers) {
      const l = draftTarget(d, id); const base = getValue(l, path, 0); const ks = [{ id: newId('k'), t: 0, v: base, ease: [0, 0, 1, 1] }];
      for (const b of beats) { if (b > d.duration) break; ks.push({ id: newId('k'), t: b, v: base * (1 + amount / 100), ease: [0.16, 1, 0.3, 1] }, { id: newId('k'), t: +(b + Math.min(0.25, 30 / (d.audio.bpm || 120))).toFixed(4), v: base, ease: [0.33, 0, 0.67, 1] }); }
      l.tracks[path] = sortKeys(ks.filter((k, i, a) => !a.slice(0, i).some((x) => Math.abs(x.t - k.t) < 1e-3)));
    }
  });
  S().toast(`비트 ${beats.length}개에 ${path} 펄스 적용`);
}
/** Audio layer source URL (workspace file or embedded asset). */
export const audioUrl = (l) => (l.content.assetId ? S().assets[l.content.assetId]?.url : S().project.workspace && l.content.src ? WS.fileUrl(S().project.workspace.id, l.content.src) : null);
export const audioKey = (l) => { const u = audioUrl(l); return u ? { id: u.length > 200 ? l.content.assetId : u, url: u } : null; };
/** Selected audio layer, else the first one. */
export const activeAudio = () => { const { project, sel } = S(); const a = project.layers.filter((l) => l.type === 'audio'); return a.find((l) => sel.layers.includes(l.id)) || a[0]; };
export async function runBeatDetection() {
  const l = activeAudio(); const k = l && audioKey(l); if (!k) return S().toast('오디오 레이어가 없습니다');
  const buf = bufferOf(k.id) || (await decode(k));
  const { onsets, bpm } = detectBeats(buf);
  S().mutate((d) => { d.audio.beats = onsets.map((t) => +(t - (l.content.trim || 0) + (l.inPoint || 0)).toFixed(4)).filter((t) => t >= 0); d.audio.bpm = bpm; });
  S().toast(`비트 ${onsets.length}개 감지 · 추정 BPM ${bpm}`);
}
export async function audioToKeys(lo = 100, hi = 130) {
  const { sel } = S(); const l = activeAudio(); const k = l && audioKey(l);
  if (!k) return S().toast('오디오 레이어가 없습니다');
  if (!sel.path) return S().toast('타임라인에서 속성을 선택하세요');
  const buf = bufferOf(k.id) || (await decode(k));
  const env = envelope(buf, project.fps);
  S().mutate((d) => {
    const t = draftTarget(d, sel.path.target); if (!t) return;
    t.tracks[sel.path.path] = env.map((v, i) => ({ id: newId('k'), t: +((i / d.fps) - (l.content.trim || 0) + (l.inPoint || 0)).toFixed(4), v: +(lo + (hi - lo) * v).toFixed(3), ease: [0, 0, 1, 1] })).filter((k) => k.t <= d.duration);
  });
  S().toast('오디오 진폭 → 키프레임 변환 완료');
}
export function setAudio(assetId) { S().mutate((d) => { d.audio = { ...d.audio, assetId, beats: [], bpm: 0 }; }); }
export { LAYER_TYPES };

// ───────── folder (workspace) projects ─────────
import * as WS from './workspace.js';
import { parseParams, setParam, findLeaf, compMeta, hasParams } from './codeparams.js';
import { fileText } from '../store.js';

const CODE_SKIP = /(^|\/)(node_modules|dist|build|scripts|test|tests|out)\//;
const AUDIO_EXT = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;

/** Open a folder served by the dev server. Uses motion.project.json when present. */
export async function openWorkspace(root, entry) {
  S().setBusy('프로젝트 폴더 여는 중…');
  try {
    const id = root.id || root;
    const { files, root: abs } = await WS.tree(id);
    const name = abs.split(/[\\/]/).pop();
    if (files.some((f) => f.path === 'motion.project.json') && !entry) {
      const project = JSON.parse(await WS.readText(id, 'motion.project.json'));
      project.workspace = { ...project.workspace, id, root: abs };
      project.files = {};
      S().loadProject(project, project.assets || {}, {});
      S().toast(`프로젝트 열기: ${project.name}`);
      return;
    }
    entry ||= files.find((f) => f.path === 'index.html')?.path || files.find((f) => /\.html?$/i.test(f.path))?.path;
    if (!entry) throw new Error('HTML 파일이 없는 폴더입니다');
    const html = await WS.readText(id, entry);
    // code modules with literal parameters
    const jsFiles = files.filter((f) => /\.(m?js)$/i.test(f.path) && !CODE_SKIP.test(f.path) && f.size < 400000);
    const cache = { [entry]: html }, codeFiles = [];
    let meta = {};
    for (const f of jsFiles) { const t = await WS.readText(id, f.path); cache[f.path] = t; if (hasParams(t)) { codeFiles.push(f.path); meta = { ...compMeta(t), ...meta }; } }
    const size = meta.width && meta.height ? { width: meta.width, height: meta.height } : guessSize(html);
    const fps = meta.fps || 30;
    S().setBusy('애니메이션 분석 중… (CSS · GSAP · Canvas/WebGL · 오디오)');
    const res = await analyzeSource(null, { ...size, fps: Math.min(fps, 30), maxDuration: meta.duration || 30, url: WS.pageUrl(id, entry, Date.now()) });
    const duration = meta.duration || Math.max(3, res.duration);
    const project = createProject({ name, ...size, fps, duration, source: null, procedural: res.procedural, workspace: { id, root: abs, entry } });
    const L = [];
    for (const c of res.canvases || []) L.push(elementLayer({ ...c, name: `Script · ${c.name}` }, project, L.length));
    L.forEach((l) => { l.type = 'script'; l.content = { speed: 100 }; });
    L.push(...res.layers.map((l, i) => elementLayer(l, project, L.length + i)).reverse());
    for (const m of res.media || []) {
      const src = new URL(m.src, 'http://x/' + entry).pathname.slice(1);
      L.push(createLayer('audio', project, { name: m.name, content: { src, volume: 1, mute: false, trim: 0 }, inPoint: 0, outPoint: duration }));
    }
    const numCount = (t) => { let n = 0; const w = (p) => { if (p.kind === 'number') n++; (p.children || []).forEach(w); }; parseParams(t).params.forEach(w); return n; };
    codeFiles.sort((a, b) => numCount(cache[b]) - numCount(cache[a]));
    for (const f of codeFiles) L.push(createLayer('code', project, { name: f.split('/').pop(), content: { file: f }, inPoint: 0, outPoint: duration }));
    L.forEach((l) => { l.outPoint = duration; });
    project.layers = L;
    S().loadProject(project, {}, cache);
    S().toast(`폴더 가져오기: 레이어 ${L.length}개 (스크립트 ${res.canvases?.length || 0} · 요소 ${res.layers.length} · 오디오 ${res.media?.length || 0} · 코드 ${codeFiles.length})${res.renderAt ? ' · renderAt(t) 감지' : ''}`);
  } catch (e) { console.error(e); S().toast('폴더 열기 실패: ' + e.message); }
  finally { S().setBusy(null); }
}

export async function uploadAndOpen(name, files) {
  S().setBusy(`업로드 중… 0/${files.length}`);
  try {
    const r = await WS.uploadFolder(name, files, (i, n) => S().setBusy(`업로드 중… ${i}/${n}`));
    await openWorkspace(r.id);
  } catch (e) { S().toast('업로드 실패: ' + e.message); S().setBusy(null); }
}

/** Ensure a workspace file is loaded into the cache. */
export async function loadFile(path) {
  const s = S(); const ws = s.project.workspace; if (!ws) return '';
  if (fileText(s, path) != null) return fileText(s, path);
  const t = await WS.readText(ws.id, path); S().cacheFile(path, t); return t;
}
/** Edit a file (undoable). Disk write + preview reload happen in the viewer sync. */
export function editFile(path, text, merge) {
  S().mutate((d) => {
    d.files[path] = text;
    const m = compMeta(text);
    if (m.duration && m.duration !== d.duration) { d.duration = m.duration; d.layers.forEach((l) => { l.outPoint = Math.max(l.outPoint, m.duration); }); }
    if (m.fps) d.fps = m.fps;
    if (m.width) d.width = m.width;
    if (m.height) d.height = m.height;
  }, { merge: merge || 'file-' + path });
}
/** Change one literal in a code module. */
export function setCodeParam(file, path, value, merge) {
  const text = fileText(S(), file); if (text == null) return;
  const leaf = findLeaf(text, path); if (!leaf) return;
  editFile(file, setParam(text, leaf, value), merge || 'param-' + file + path.join('.'));
}
export async function saveWorkspace() {
  const { project, assets } = S(); const ws = project.workspace;
  const { files, ...rest } = project;
  for (const [p, t] of Object.entries(files || {})) await WS.writeText(ws.id, p, t);
  await WS.writeText(ws.id, 'motion.project.json', JSON.stringify({ ...rest, assets }, null, 2));
  S().toast('저장 완료: motion.project.json + 수정한 코드 파일 (폴더에 기록)');
}
export async function exportWorkspaceZip() {
  const { project, assets } = S(); const ws = project.workspace;
  const { files, ...rest } = project;
  for (const [p, t] of Object.entries(files || {})) await WS.writeText(ws.id, p, t);
  const blob = await WS.exportZip(ws.id, ws.entry, runtimeProject({ ...rest, source: null }, assets));
  download(blob, `${project.name}.zip`);
  S().toast('ZIP 내보내기 완료 — 정적 서버로 열면 편집한 그대로 재생됩니다');
}
export function addAudioLayer(src, name, assetId = null) {
  return addLayer('audio', { name, content: { src, assetId, volume: 1, mute: false, trim: 0 } });
}
export { WS, AUDIO_EXT };
