// Frame-exact renderer: headless Chromium seeks the Motion runtime to every frame, screenshots it,
// and pipes the frames into ffmpeg. Used by the editor's Render button (vite plugin) and the CLI.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ffmpegPath from 'ffmpeg-static';
import { localVendorFile } from './vendors.js';

export const FORMATS = {
  mp4: { ext: 'mp4', label: 'H.264 MP4', args: (q) => ['-c:v', 'libx264', '-preset', 'medium', '-crf', String(q.crf ?? 16), '-pix_fmt', 'yuv420p', '-movflags', '+faststart'], audio: ['-c:a', 'aac', '-b:a', '192k'] },
  webm: { ext: 'webm', label: 'VP9 WebM', args: (q) => ['-c:v', 'libvpx-vp9', '-crf', String(q.crf ?? 24), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '2'], audio: ['-c:a', 'libopus', '-b:a', '160k'] },
  mov: { ext: 'mov', label: 'ProRes 422 HQ MOV', args: () => ['-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le'], audio: ['-c:a', 'pcm_s16le'] },
  gif: { ext: 'gif', label: 'Animated GIF', args: () => ['-vf', 'split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a', '-loop', '0'], audio: null },
};

function dataUrlToFile(url, dir) {
  const m = url.match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
  if (!m) return url; // already a path
  const ext = (m[1] || '').split('/')[1]?.replace('mpeg', 'mp3') || 'bin';
  const file = path.join(dir, 'audio.' + ext);
  fs.writeFileSync(file, m[2] ? Buffer.from(m[3], 'base64') : decodeURIComponent(m[3]));
  return file;
}

export function readProjectFromDocument(html) {
  const m = html.match(/<script type="application\/json" id="motion-project">([\s\S]*?)<\/script>/);
  if (!m) throw new Error('Not a .motion.html document (no embedded project). Save it from the editor first.');
  return JSON.parse(m[1].replace(/<\\\//g, '</').replace(/<\\!--/g, '<!--'));
}

async function launch() {
  const { chromium } = await import('playwright');
  const exe = process.env.CHROMIUM_PATH;
  try { return await chromium.launch(exe ? { executablePath: exe } : {}); }
  catch (e) {
    if (!exe && fs.existsSync('/opt/pw-browsers/chromium')) return chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
    throw new Error(`${e.message}\n→ Run "npx playwright install chromium" once.`);
  }
}

/**
 * @param {object} o  html (motion document), out (file), format, fps?, start?, end?, scale?, crf?, onProgress(f, total), signal
 */
export async function renderVideo(o) {
  const project = readProjectFromDocument(o.html);
  const fmt = FORMATS[o.format || 'mp4'];
  if (!fmt) throw new Error('Unknown format ' + o.format);
  const fps = o.fps || project.fps, scale = o.scale || 1;
  const W = project.width, H = project.height;
  const start = Math.max(0, o.start ?? 0), end = Math.min(project.duration, o.end ?? project.duration);
  const total = Math.max(1, Math.round((end - start) * fps));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-'));

  const browser = await launch();
  let ff;
  try {
    const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: scale });
    await page.addInitScript(() => { window.__MOTION_RENDER__ = true; });
    page.on('pageerror', (e) => o.log?.('page error: ' + e.message));
    await page.route('http://motion.render/', (r) => r.fulfill({ body: o.html, contentType: 'text/html; charset=utf-8' }));
    await page.route(/^https?:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net|unpkg\.com)\//, (r) => {
      const f = localVendorFile(r.request().url());
      return f ? r.fulfill({ path: f, contentType: 'text/javascript' }) : r.continue();
    });
    await page.goto('http://motion.render/', { waitUntil: 'load', timeout: 120000 });
    await page.waitForFunction(() => window.__MOTION_READY__ === true, null, { timeout: 120000 });

    const cdp = await page.context().newCDPSession(page);
    const args = ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'png', '-i', 'pipe:0'];
    const au = project.audio;
    const audioAsset = au?.assetId && project.assets?.[au.assetId];
    if (audioAsset && fmt.audio) {
      const file = dataUrlToFile(audioAsset.url, tmp), off = au.offset || 0;
      if (start - off > 0) args.push('-ss', String(start - off));
      if (off - start > 0) args.push('-itsoffset', String(off - start));
      args.push('-i', file, '-map', '0:v', '-map', '1:a', '-af', `volume=${au.volume ?? 1}`, ...fmt.audio, '-t', String(end - start));
    }
    const vf = fmt.ext === 'gif' ? [] : ['-vf', 'pad=ceil(iw/2)*2:ceil(ih/2)*2'];
    args.push(...vf, ...fmt.args(o), '-r', String(fps), o.out);
    ff = spawn(ffmpegPath, args, { stdio: ['pipe', 'ignore', 'pipe'] });
    let ffErr = '';
    ff.stderr.on('data', (d) => (ffErr += d));
    const done = new Promise((res, rej) => ff.on('close', (c) => (c === 0 ? res() : rej(new Error('ffmpeg failed: ' + ffErr.slice(-800))))));

    for (let i = 0; i < total; i++) {
      if (o.signal?.aborted) throw new Error('Render cancelled');
      const t = start + i / fps;
      await page.evaluate((t) => MotionRuntime.seek(t), t);
      // CDP capture with fast (still lossless) PNG encoding — ~3× faster than page.screenshot
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true });
      const png = Buffer.from(data, 'base64');
      if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
      o.onProgress?.(i + 1, total);
    }
    ff.stdin.end();
    await done;
    return { out: o.out, frames: total, width: W * scale, height: H * scale, fps };
  } finally {
    if (ff && ff.exitCode === null) ff.stdin.destroy();
    await browser.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
