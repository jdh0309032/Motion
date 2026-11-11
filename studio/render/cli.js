#!/usr/bin/env node
// Usage: node render/cli.js <project.motion.html | project-folder (with motion.project.json)> [-o out.mp4] [--format mp4|webm|mov|gif] [--fps 30] [--start 0] [--end 6] [--scale 1] [--crf 16]
import fs from 'node:fs';
import path from 'node:path';
import { renderVideo, FORMATS } from './render.js';

const argv = process.argv.slice(2);
const input = argv.find((a, i) => !a.startsWith('-') && !argv[i - 1]?.startsWith('-'));
const opt = (n, d) => { const i = argv.findIndex((a) => a === `--${n}` || (n === 'out' && a === '-o')); return i >= 0 ? argv[i + 1] : d; };
if (!input) { console.log('Usage: node render/cli.js <file.motion.html> [-o out.mp4] [--format ' + Object.keys(FORMATS).join('|') + '] [--fps N] [--start s] [--end s] [--scale k] [--crf q]'); process.exit(1); }
const format = opt('format', path.extname(opt('out', '')).slice(1) || 'mp4');
const isDir = fs.existsSync(input) && fs.statSync(input).isDirectory();
const out = opt('out', (isDir ? path.join(input, 'out', path.basename(path.resolve(input))) : input.replace(/(\.motion)?\.html?$/i, '')) + '.' + FORMATS[format].ext);
if (isDir) fs.mkdirSync(path.dirname(out), { recursive: true });
const src = isDir ? (() => { const project = JSON.parse(fs.readFileSync(path.join(input, 'motion.project.json'), 'utf8')); return { root: path.resolve(input), entry: project.workspace?.entry || 'index.html', project }; })() : { html: fs.readFileSync(input, 'utf8') };
const num = (n) => (opt(n) != null ? +opt(n) : undefined);
const t0 = Date.now();
renderVideo({
  ...src, out, format, fps: num('fps'), start: num('start'), end: num('end'), scale: num('scale'), crf: num('crf'),
  log: (m) => console.warn(m),
  onProgress: (f, n) => { if (f === n || f % Math.max(1, Math.round(n / 50)) === 0) process.stdout.write(`\rRendering ${f}/${n} frames (${Math.round((f / n) * 100)}%)`); },
}).then((r) => console.log(`\nDone → ${r.out}  ${r.width}×${r.height} @${r.fps}fps, ${r.frames} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`))
  .catch((e) => { console.error('\n' + e.message); process.exit(1); });
