// Dev-server API so the editor's Render button produces real files locally.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renderVideo, FORMATS } from './render.js';
import { localVendorFile } from './vendors.js';

export default function motionRender() {
  const jobs = new Map();
  return {
    name: 'motion-render',
    configureServer(server) {
      // /vendor?u=<cdn url> → local copy (the editor rewrites CDN script tags inside the preview frame)
      server.middlewares.use('/vendor', (req, res, next) => {
        const u = new URL(req.url, 'http://x').searchParams.get('u'), f = u && localVendorFile(u);
        if (!f) { res.statusCode = 302; res.setHeader('location', u || '/'); return res.end(); }
        res.setHeader('content-type', 'text/javascript'); fs.createReadStream(f).pipe(res);
      });
      server.middlewares.use('/api/render', (req, res) => {
        const send = (code, obj) => { res.statusCode = code; res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
        const [, id, file] = (req.url || '').split('/');
        if (req.method === 'GET' && !id) return send(200, { ok: true, formats: Object.fromEntries(Object.entries(FORMATS).map(([k, f]) => [k, f.label])) });
        if (req.method === 'POST' && !id) {
          let body = '';
          req.on('data', (c) => (body += c));
          req.on('end', () => {
            try {
              const o = JSON.parse(body);
              const jid = Math.random().toString(36).slice(2, 10), ac = new AbortController();
              const ext = FORMATS[o.format || 'mp4'].ext;
              const out = path.join(os.tmpdir(), `motion-${jid}.${ext}`);
              const job = { id: jid, frame: 0, total: 0, done: false, error: null, out, name: (o.name || 'render') + '.' + ext, ac, started: Date.now() };
              jobs.set(jid, job);
              renderVideo({ ...o, out, signal: ac.signal, onProgress: (f, n) => { job.frame = f; job.total = n; } })
                .then(() => (job.done = true)).catch((e) => (job.error = e.message));
              send(200, { id: jid });
            } catch (e) { send(400, { error: e.message }); }
          });
          return;
        }
        const job = jobs.get(id);
        if (!job) return send(404, { error: 'no such job' });
        if (req.method === 'DELETE') { job.ac.abort(); return send(200, { ok: true }); }
        if (file === 'file') {
          if (!job.done) return send(409, { error: 'not ready' });
          res.setHeader('content-disposition', `attachment; filename="${job.name}"`);
          return fs.createReadStream(job.out).pipe(res);
        }
        send(200, { frame: job.frame, total: job.total, done: job.done, error: job.error, elapsed: (Date.now() - job.started) / 1000 });
      });
    },
  };
}
