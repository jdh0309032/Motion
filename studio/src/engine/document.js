import RUNTIME from '../runtime/motion-runtime.js?raw';

const esc = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');
const TAG_RT = 'motion-runtime', TAG_PJ = 'motion-project', TAG_BOOT = 'motion-boot';

const CDN_GSAP = /(<script[^>]+src=["'])(https?:\/\/(?:cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[^"']+|cdn\.jsdelivr\.net\/npm\/gsap@[^"']+|unpkg\.com\/gsap@[^"']+))(["'])/gi;
/** In the dev server, CDN libraries are served from local node_modules (works offline). */
export const preferLocalVendors = (source) => (import.meta.env?.DEV ? source.replace(CDN_GSAP, (_, a, u, b) => a + '/vendor?u=' + encodeURIComponent(u) + b) : source);

/** Insert the runtime as the very first script so it can virtualise the clock before page code runs. */
export function withRuntime(source, extraHead = '') {
  const tag = `<script id="${TAG_RT}">${esc(RUNTIME)}</script>${extraHead}`;
  if (/<head[^>]*>/i.test(source)) return source.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(source)) return source.replace(/<html[^>]*>/i, (m) => m + '<head>' + tag + '</head>');
  return '<!doctype html><html><head>' + tag + '</head><body>' + source + '</body></html>';
}

/** Data the runtime needs: project + resolved asset urls. */
export function runtimeProject(project, assets) {
  const a = {};
  for (const [id, x] of Object.entries(assets || {})) a[id] = { url: x.url, kind: x.kind };
  const audio = project.audio?.assetId && assets[project.audio.assetId] ? { ...project.audio, url: assets[project.audio.assetId].url } : null;
  const { source, ...rest } = project;
  return { ...rest, assets: a, audio };
}

/**
 * Self-contained .motion.html: the original page + runtime + project JSON + boot.
 * Plays in any browser, re-opens in the editor, and is what the renderer captures.
 */
export function exportDocument(project, assets) {
  const data = { ...project, source: undefined, assets };
  const boot = `<script id="${TAG_BOOT}">addEventListener('load',function(){var p=JSON.parse(document.getElementById('${TAG_PJ}').textContent);` +
    `var a={};for(var k in p.assets)a[k]={url:p.assets[k].url,kind:p.assets[k].kind};p.assets=a;` +
    `if(p.audio&&p.audio.assetId&&a[p.audio.assetId])p.audio.url=a[p.audio.assetId].url;else p.audio=null;` +
    `MotionRuntime.load(p).then(function(){if(!/[?&]render\\b/.test(location.search)&&!window.__MOTION_RENDER__)MotionRuntime.play();window.__MOTION_READY__=true;});});</script>`;
  const json = `<script type="application/json" id="${TAG_PJ}">${esc(JSON.stringify(data))}</script>`;
  let html = withRuntime(project.source);
  html = /<\/body>/i.test(html) ? html.replace(/<\/body>(?![\s\S]*<\/body>)/i, json + boot + '</body>') : html + json + boot;
  return html;
}

/** Parse a .motion.html back into { source, project, assets } (or null for a plain page). */
export function parseDocument(text) {
  const m = text.match(new RegExp(`<script type="application/json" id="${TAG_PJ}">([\\s\\S]*?)</script>`));
  if (!m) return null;
  const data = JSON.parse(m[1].replace(/<\\\//g, '</').replace(/<\\!--/g, '<!--'));
  const source = text
    .replace(new RegExp(`<script id="${TAG_RT}">[\\s\\S]*?</script>`), '')
    .replace(m[0], '')
    .replace(new RegExp(`<script id="${TAG_BOOT}">[\\s\\S]*?</script>`), '');
  const { assets = {}, ...project } = data;
  return { project: { ...project, source }, assets };
}

/** Best guess at the intended frame size of a Claude-made page. */
export function guessSize(source) {
  const meta = source.match(/<meta[^>]+name=["']motion:size["'][^>]+content=["'](\d+)\s*[x×]\s*(\d+)/i);
  if (meta) return { width: +meta[1], height: +meta[2] };
  const css = source.match(/(?:html|body)[^{]*\{[^}]*width:\s*(\d{3,4})px[^}]*height:\s*(\d{3,4})px/i);
  if (css) return { width: +css[1], height: +css[2] };
  const vb = source.match(/aspect-ratio:\s*(\d+)\s*\/\s*(\d+)/);
  if (vb && +vb[1] < +vb[2]) return { width: 1080, height: 1920 };
  return { width: 1920, height: 1080 };
}

/** Run the runtime's analysis in an off-screen frame. */
export function analyzeSource(source, { width, height, fps, maxDuration = 30 }) {
  return new Promise((resolve, reject) => {
    const f = document.createElement('iframe');
    f.style.cssText = `position:fixed;left:-20000px;top:0;width:${width}px;height:${height}px;border:0;visibility:hidden`;
    const timer = setTimeout(() => { f.remove(); reject(new Error('Analysis timed out')); }, 60000);
    f.onload = async () => {
      try {
        const rt = f.contentWindow.MotionRuntime;
        const res = await rt.analyze({ fps, maxDuration });
        resolve(res);
      } catch (e) { reject(e); } finally { clearTimeout(timer); setTimeout(() => f.remove(), 0); }
    };
    f.srcdoc = withRuntime(preferLocalVendors(source));
    document.body.appendChild(f);
  });
}
