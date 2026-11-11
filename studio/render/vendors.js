// Serve well-known CDN libraries from local node_modules (offline + deterministic renders).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const VENDOR_RE = /^https?:\/\/(?:cdnjs\.cloudflare\.com\/ajax\/libs\/gsap\/[^/]+|cdn\.jsdelivr\.net\/npm\/gsap@[^/]+\/dist|unpkg\.com\/gsap@[^/]+\/dist)\/([\w.-]+\.js)(?:\?.*)?$/;

export function localVendorFile(url) {
  const m = url.match(VENDOR_RE);
  if (!m) return null;
  try {
    const dir = path.dirname(require.resolve('gsap/package.json'));
    const f = path.join(dir, 'dist', path.basename(m[1]));
    return fs.existsSync(f) ? f : null;
  } catch { return null; }
}
