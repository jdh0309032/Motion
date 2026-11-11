// Client side of the workspace server (folder projects).
const api = async (url, opts) => { const r = await fetch(url, opts); if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || r.statusText); return r; };
export const wsAvailable = () => fetch('/api/ws/roots').then((r) => r.ok).catch(() => false);
export const roots = () => api('/api/ws/roots').then((r) => r.json());
export const browse = (path) => api('/api/ws/browse' + (path ? '?path=' + encodeURIComponent(path) : '')).then((r) => r.json());
export const tree = (ws) => api(`/api/ws/tree?ws=${ws}`).then((r) => r.json());
export const readText = (ws, path) => api(`/api/ws/file?ws=${ws}&path=${encodeURIComponent(path)}`).then((r) => r.text());
export const exists = (ws, path) => fetch(`/api/ws/file?ws=${ws}&path=${encodeURIComponent(path)}`, { method: 'GET' }).then((r) => r.ok);
export const writeText = (ws, path, text) => api(`/api/ws/file?ws=${ws}&path=${encodeURIComponent(path)}`, { method: 'PUT', body: text });
/** URL of a project file as served to the preview / renderer. */
export const fileUrl = (ws, path) => `/ws/${ws}/${path.split('/').map(encodeURIComponent).join('/')}`;
export const pageUrl = (ws, entry, nonce = 0) => `${fileUrl(ws, entry)}?render&motion&v=${nonce}`;

const b64 = (buf) => { let s = ''; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
/** Upload a folder chosen in the browser (webkitdirectory files or dropped entries). */
export async function uploadFolder(name, files, onProgress) {
  const list = files.filter((f) => !/(^|\/)(node_modules|\.git)\//.test(f.path));
  const out = [];
  for (let i = 0; i < list.length; i++) { out.push({ path: list[i].path, b64: b64(await list[i].file.arrayBuffer()) }); onProgress?.(i + 1, list.length); }
  return api('/api/ws/upload', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, files: out }) }).then((r) => r.json());
}
/** Recursively read a dropped directory (DataTransferItem.webkitGetAsEntry). */
export async function readDroppedEntry(entry, prefix = '') {
  if (entry.isFile) return [{ path: prefix + entry.name, file: await new Promise((r, j) => entry.file(r, j)) }];
  if (/^(node_modules|\.git)$/.test(entry.name)) return [];
  const reader = entry.createReader(), all = [];
  for (;;) { const batch = await new Promise((r, j) => reader.readEntries(r, j)); if (!batch.length) break; all.push(...batch); }
  return (await Promise.all(all.map((e) => readDroppedEntry(e, prefix + entry.name + '/')))).flat();
}
export async function exportZip(ws, entry, project) {
  const r = await api(`/api/ws/export?ws=${ws}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project, entry }) });
  return r.blob();
}
