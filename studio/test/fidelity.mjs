// Fidelity regression: for every example, the original page (CSS/WAAPI/GSAP, clock-driven) and the
// imported keyframe project must put every animated element in the same place at every sampled time.
// Run: npm run test:fidelity   (needs Chromium: npx playwright install chromium)
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { localVendorFile } from '../render/vendors.js';

const RT = fs.readFileSync(new URL('../src/runtime/motion-runtime.js', import.meta.url), 'utf8');
const dir = new URL('../public/examples/', import.meta.url).pathname;
const files = process.argv.slice(2).length ? process.argv.slice(2) : fs.readdirSync(dir).filter((f) => f.endsWith('.html')).map((f) => path.join(dir, f));
const TOL = 1.0; // px (position/size) and % (opacity)

const exe = fs.existsSync('/opt/pw-browsers/chromium') && !process.env.CHROMIUM_PATH ? undefined : process.env.CHROMIUM_PATH;
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
let failed = 0;
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8').replace(/<head>/i, '<head><script>' + RT.replace(/<\/script/g, '<\\/script') + '</script>');
  const open = async () => {
    const p = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    p.on('pageerror', (e) => console.log('  page error:', e.message));
    await p.route(/^https?:\/\/(cdnjs|cdn\.jsdelivr|unpkg)/, (r) => { const f = localVendorFile(r.request().url()); return f ? r.fulfill({ path: f, contentType: 'text/javascript' }) : r.abort(); });
    await p.route('http://fixture/', (r) => r.fulfill({ body: html, contentType: 'text/html' }));
    await p.goto('http://fixture/');
    return p;
  };
  const A = await open();
  const res = await A.evaluate(() => MotionRuntime.analyze({ fps: 30, maxDuration: 8 }));
  const project = { width: 1920, height: 1080, fps: 30, duration: res.duration, layers: res.layers.map((l, i) => ({ id: 'L' + i, ...l, effects: [] })) };
  const R = await open(), E = await open();
  await E.evaluate((p) => MotionRuntime.load(p), project);
  const sels = res.layers.map((l) => l.selector);
  const probe = (sels) => sels.map((s) => { const e = document.querySelector(s), r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height, +getComputedStyle(e).opacity * 100]; });
  let worst = 0;
  for (let t = 0.1; t < Math.min(res.duration, 6); t += 0.37) {
    const ref = await R.evaluate(({ t, sels, probe }) => { MotionRuntime.advanceTo(t * 1000, 1000 / 30); document.getAnimations().forEach((a) => { a.pause(); a.currentTime = t * 1000; }); return new Function('sels', `return (${probe})(sels)`)(sels); }, { t, sels, probe: probe.toString() });
    const got = await E.evaluate(({ t, sels, probe }) => { MotionRuntime.seek(t); return new Function('sels', `return (${probe})(sels)`)(sels); }, { t, sels, probe: probe.toString() });
    ref.forEach((r, i) => r.forEach((v, j) => (worst = Math.max(worst, Math.abs(v - got[i][j])))));
  }
  const keys = res.layers.reduce((n, l) => n + Object.values(l.tracks).reduce((a, k) => a + k.length, 0), 0);
  const ok = worst <= TOL; if (!ok) failed++;
  console.log(`${ok ? 'PASS' : 'FAIL'} ${path.basename(file)} — ${res.layers.length} layers, ${keys} keys, worst error ${worst.toFixed(3)}`);
  await Promise.all([A.close(), R.close(), E.close()]);
}
await browser.close();
process.exit(failed ? 1 : 0);
