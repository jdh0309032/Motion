// Workspace server: lets the editor open whole project folders (multi-file HTML/ES-module/Three.js
// projects), edit their files, and serve them to the preview / renderer with the Motion runtime injected.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zip } from './zip.js';

const STUDIO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const UPLOADS = path.join(STUDIO, 'workspaces');
const RUNTIME = path.join(STUDIO, 'src/runtime/motion-runtime.js');
const SKIP = new Set(['node_modules', '.git', '.DS_Store', 'dist', '.cache', '.next']);
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.avif': 'image/avif', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.flac': 'audio/flac',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.hdr': 'application/octet-stream', '.wasm': 'application/wasm',
};
export const mime = (f) => TYPES[path.extname(f).toLowerCase()] || 'application/octet-stream';

export function roots() {
  const env = process.env.MOTION_ROOTS ? process.env.MOTION_ROOTS.split(path.delimiter) : [path.resolve(STUDIO, '..', '..')];
  fs.mkdirSync(UPLOADS, { recursive: true });
  return [...new Set([...env.map((p) => path.resolve(p)), UPLOADS])].filter((p) => fs.existsSync(p));
}
const inside = (p) => roots().some((r) => p === r || p.startsWith(r + path.sep));
export const wsId = (root) => Buffer.from(root).toString('base64url');
export const wsRoot = (id) => { const r = path.resolve(Buffer.from(id, 'base64url').toString()); if (!inside(r)) throw new Error('outside allowed roots'); return r; };
function safeJoin(root, rel) {
  const p = path.resolve(root, '.' + path.sep + (rel || '').replace(/^\/+/, ''));
  if (p !== root && !p.startsWith(root + path.sep)) throw new Error('bad path');
  return p;
}

export function listFiles(root, max = 4000) {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP.has(e.name) || out.length >= max) continue;
      const r = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) walk(path.join(dir, e.name), r);
      else out.push({ path: r, size: fs.statSync(path.join(dir, e.name)).size });
    }
  };
  walk(root, '');
  return out;
}

/** Inject the runtime as the first script of an HTML page (+ optional boot data). */
export function injectRuntime(html, before = '') {
  const tag = `${before}<script id="motion-runtime">${fs.readFileSync(RUNTIME, 'utf8').replace(/<\/script/gi, '<\\/script')}</script>`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  return tag + html;
}

/** node_modules fallback: projects without `npm install` still run (three, gsap … from the studio). */
export function resolveFile(root, rel) {
  const p = safeJoin(root, rel);
  if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  const m = rel.match(/(?:^|\/)node_modules\/(.+)$/);
  if (m) { const f = path.join(STUDIO, 'node_modules', m[1]); if (fs.existsSync(f) && fs.statSync(f).isFile()) return f; }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory() && fs.existsSync(path.join(p, 'index.html'))) return path.join(p, 'index.html');
  return null;
}

const readBody = (req) => new Promise((res, rej) => { const c = []; req.on('data', (d) => c.push(d)); req.on('end', () => res(Buffer.concat(c))); req.on('error', rej); });
const json = (res, code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };

export function workspaceMiddleware() {
  return async (req, res, next) => {
    const url = new URL(req.url, 'http://x');
    try {
      // ── static: /ws/<id>/<path>  (HTML gets the runtime when ?motion is present)
      if (url.pathname.startsWith('/ws/')) {
        const [, , id, ...rest] = url.pathname.split('/');
        const root = wsRoot(id), rel = decodeURIComponent(rest.join('/')) || 'index.html';
        const f = resolveFile(root, rel);
        if (!f) { res.statusCode = 404; return res.end('not found: ' + rel); }
        res.setHeader('content-type', mime(f));
        res.setHeader('cache-control', 'no-store');
        if (/\.html?$/i.test(f) && url.searchParams.has('motion')) return res.end(injectRuntime(fs.readFileSync(f, 'utf8')));
        return fs.createReadStream(f).pipe(res);
      }
      if (!url.pathname.startsWith('/api/ws')) return next();
      const op = url.pathname.slice('/api/ws/'.length), q = (k) => url.searchParams.get(k);

      if (op === 'roots') return json(res, 200, roots().map((r) => ({ path: r, id: wsId(r) })));
      if (op === 'browse') {
        const p = path.resolve(q('path') || roots()[0]);
        if (!inside(p)) return json(res, 403, { error: 'outside allowed roots' });
        const entries = fs.readdirSync(p, { withFileTypes: true }).filter((e) => !e.name.startsWith('.') && e.name !== 'node_modules')
          .map((e) => {
            const full = path.join(p, e.name), dir = e.isDirectory();
            const project = dir && ['index.html', 'motion.project.json'].some((f) => fs.existsSync(path.join(full, f)));
            return { name: e.name, dir, project, html: !dir && /\.html?$/i.test(e.name) };
          }).filter((e) => e.dir || e.html).sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
        const parent = path.dirname(p);
        return json(res, 200, { path: p, id: wsId(p), parent: inside(parent) && parent !== p ? parent : null, entries, hasIndex: fs.existsSync(path.join(p, 'index.html')), hasProject: fs.existsSync(path.join(p, 'motion.project.json')) });
      }
      if (op === 'upload' && req.method === 'POST') {
        const { name, files } = JSON.parse((await readBody(req)).toString());
        const dir = path.join(UPLOADS, (name || 'project').replace(/[^\w.-]+/g, '_'));
        for (const f of files) { const p = safeJoin(dir, f.path); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, Buffer.from(f.b64, 'base64')); }
        return json(res, 200, { root: dir, id: wsId(dir) });
      }
      const root = wsRoot(q('ws'));
      if (op === 'tree') return json(res, 200, { root, files: listFiles(root) });
      if (op === 'file') {
        const p = safeJoin(root, q('path'));
        if (req.method === 'PUT') { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, await readBody(req)); return json(res, 200, { ok: true }); }
        if (!fs.existsSync(p)) return json(res, 404, { error: 'not found' });
        res.setHeader('content-type', mime(p)); return fs.createReadStream(p).pipe(res);
      }
      if (op === 'export' && req.method === 'POST') {
        // ZIP: every project file + motion/ runtime & project; the entry page boots the edited composition.
        const { project, entry = 'index.html' } = JSON.parse((await readBody(req)).toString());
        const files = listFiles(root).filter((f) => f.path !== 'motion.project.json').map((f) => ({ path: f.path, data: fs.readFileSync(path.join(root, f.path)) }));
        const boot = `<script>window.__MOTION_PROJECT__=${JSON.stringify(project).replace(/</g, '\\u003c')};</script>`;
        const ent = files.find((f) => f.path === entry);
        if (ent) ent.data = Buffer.from(injectRuntime(ent.data.toString('utf8'), boot));
        files.push({ path: 'motion.project.json', data: Buffer.from(JSON.stringify(project, null, 2)) });
        files.push({ path: 'README-MOTION.txt', data: Buffer.from(`Edited with Motion Studio.\nServe this folder over http (e.g. "npx serve" or "python3 -m http.server") and open ${entry}.\nIf the project uses npm packages, run "npm install" first.\n`) });
        res.setHeader('content-type', 'application/zip');
        res.setHeader('content-disposition', `attachment; filename="${(project.name || 'motion').replace(/[^\w.-]+/g, '_')}.zip"`);
        return res.end(zip(files));
      }
      json(res, 404, { error: 'unknown op ' + op });
    } catch (e) { json(res, 400, { error: e.message }); }
  };
}
