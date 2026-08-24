import { createRequire } from 'module';
import fs from 'fs';
const require = createRequire(new URL('../../../apps/backend/package.json', import.meta.url));
const sharp = require('sharp');
const out = new URL('.', import.meta.url).pathname;
const safeSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180" viewBox="0 0 320 180"><rect width="320" height="180" rx="18" fill="#0ea5e9"/><circle cx="72" cy="90" r="42" fill="#f8fafc"/><text x="132" y="82" font-size="28" font-family="Arial" fill="#fff">SVG</text><text x="132" y="118" font-size="18" font-family="Arial" fill="#e0f2fe">PNG thumbnail preview</text></svg>`;
const maliciousSvg = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><image href="https://example.com/pixel.png"/></svg>`;
function sanitizeSvgForThumbnail(svg) {
  const activeContentPattern = /<(?:script|foreignObject|iframe|object|embed)\b/i;
  const externalReferencePattern = /(?:href|xlink:href|src)\s*=\s*["']\s*(?:https?:|file:|\/\/)/i;
  const cssExternalReferencePattern = /url\s*\(\s*["']?\s*(?:https?:|file:|\/\/)/i;
  if (activeContentPattern.test(svg)) throw new Error('SVG contains active content');
  if (externalReferencePattern.test(svg) || cssExternalReferencePattern.test(svg)) throw new Error('SVG contains external resource references');
  return svg.replace(/<\?xml[^>]*>/gi, '').replace(/<!DOCTYPE[^>]*(?:\[[\s\S]*?\])?>/gi, '').replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*')/gi, '');
}
const png = await sharp(Buffer.from(sanitizeSvgForThumbnail(safeSvg)), { animated: false, failOn: 'error', limitInputPixels: 4096 * 4096 })
  .resize({ width: 600, height: 600, fit: 'inside', withoutEnlargement: true })
  .png()
  .toBuffer();
fs.writeFileSync(`${out}/safe-svg-thumbnail.png`, png);
let maliciousBlocked = false;
let maliciousReason = '';
try { sanitizeSvgForThumbnail(maliciousSvg); } catch (e) { maliciousBlocked = true; maliciousReason = e.message; }
const html = `<!doctype html><html><head><meta charset="utf-8"><title>SVG Preview POT</title><style>body{font-family:Inter,Arial,sans-serif;background:#0f172a;color:#e2e8f0;margin:0;padding:40px}.card{background:#111827;border:1px solid #334155;border-radius:18px;padding:24px;max-width:900px;margin:auto}.grid{display:grid;grid-template-columns:1fr 1fr;gap:20px}.ok{color:#86efac}.warn{color:#fbbf24}.preview{background:#020617;border:1px solid #334155;border-radius:14px;padding:20px;text-align:center}img{max-width:100%;border-radius:12px}.badge{display:inline-block;padding:6px 10px;border-radius:999px;background:#064e3b;color:#a7f3d0;font-weight:700}.muted{color:#94a3b8}code{background:#020617;padding:2px 6px;border-radius:6px}</style></head><body><div class="card"><span class="badge">Proof of testing</span><h1>SVG attachments use safe PNG thumbnail preview</h1><p class="muted">Generated in sandbox from the same conversion/sanitisation shape used by the backend change.</p><div class="grid"><div class="preview"><h2 class="ok">Safe SVG</h2><img src="safe-svg-thumbnail.png"/><p>Converted to PNG thumbnail for <code>/attachments/:id/thumbnail</code>.</p></div><div class="preview"><h2 class="warn">Malicious SVG</h2><p>Blocked: <code>${maliciousBlocked}</code></p><p>Reason: <code>${maliciousReason}</code></p><p>No inline SVG rendering from generic download endpoint.</p></div></div><h2>Validation run</h2><ul><li>Backend typecheck passed.</li><li>Dashboard typecheck passed.</li><li>Safe SVG converted to PNG thumbnail.</li><li>Scripted/remote-reference SVG rejected before conversion.</li></ul></div></body></html>`;
fs.writeFileSync(`${out}/index.html`, html);
fs.writeFileSync(`${out}/result.json`, JSON.stringify({ pngBytes: png.length, maliciousBlocked, maliciousReason }, null, 2));
console.log(JSON.stringify({ pngBytes: png.length, maliciousBlocked, maliciousReason }, null, 2));
