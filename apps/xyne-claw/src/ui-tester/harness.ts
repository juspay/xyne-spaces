export const DOM_AUDIT_SOURCE = String.raw`() => {
  const vw = document.documentElement.clientWidth;
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) !== 0;
  };
  const leaves = [...document.querySelectorAll("body *")].filter((el) => el.children.length === 0 && visible(el) && (el.textContent || "").trim());
  const offRight = leaves.filter((el) => el.getBoundingClientRect().right > vw + 2).slice(0, 10).map((el) => (el.textContent || "").trim().slice(0, 40));
  const narrowText = leaves.filter((el) => (el.textContent || "").trim().length > 25 && el.getBoundingClientRect().width < 90).length;
  const text = document.body.innerText || "";
  const garbage = [...new Set(text.match(/\b(NaN|undefined|\[object Object\]|Invalid Date)\b/g) || [])];
  const toastSel = '[role="status"],[role="alert"],[data-sonner-toast],[class*="toast" i]';
  const toasts = [...document.querySelectorAll(toastSel)].filter(visible).map((e) => (e.textContent || "").trim()).filter(Boolean);
  const counts = {};
  for (const t of toasts) counts[t] = (counts[t] || 0) + 1;
  const duplicateToasts = Object.entries(counts).filter(([, n]) => n > 1).map(([t, n]) => t.slice(0, 60) + " x" + n);
  const errorBoundary = /something went wrong|unexpected error|application error/i.test(text);
  return {
    viewportWidth: vw,
    horizontalScroll: document.documentElement.scrollWidth > vw + 2,
    offRight,
    narrowText,
    garbage,
    duplicateToasts,
    errorBoundary,
    dark: document.documentElement.classList.contains("dark"),
    textLength: text.length,
  };
}`;

export const HARNESS_SOURCE = String.raw`"use strict";
const fs = require("fs");
const path = require("path");
let playwright;
try { playwright = require("playwright"); } catch (e) {
  try { playwright = require(path.join(process.env.NODE_PATH || "/usr/local/lib/node_modules", "playwright")); } catch (e2) {
    console.log(JSON.stringify({ ok: false, error: "playwright is not installed in this sandbox (npm i -g playwright && npx playwright install chromium)" }));
    process.exit(2);
  }
}
const AUDIT = fs.readFileSync(path.join(__dirname, "audit.js"), "utf8");
const spec = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const outDir = spec.outDir || path.join(path.dirname(process.argv[2]), "out");
fs.mkdirSync(outDir, { recursive: true });
const base = String(spec.baseUrl || "").replace(/\/$/, "");
const baseOrigin = (() => { try { return new URL(base).origin; } catch (e) { return ""; } })();

async function stubExternal(page, counter) {
  if (spec.allowExternal === true || !baseOrigin) return;
  await page.route((url) => url.origin !== baseOrigin && /^https?:$/.test(url.protocol), (route) => {
    const req = route.request();
    counter.count++;
    const host = new URL(req.url()).host;
    if (counter.hosts.length < 5 && !counter.hosts.includes(host)) counter.hosts.push(host);
    const type = req.resourceType();
    if (type === "stylesheet") return route.fulfill({ status: 200, contentType: "text/css", body: "" }).catch(() => {});
    if (type === "script") return route.fulfill({ status: 200, contentType: "application/javascript", body: "" }).catch(() => {});
    return route.abort("blockedbyclient").catch(() => {});
  });
}

async function screenshotWithRetry(page, file, fullPage, errors) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await page.screenshot({ path: file, fullPage, timeout: 15000, animations: "disabled", caret: "hide" });
      return file;
    } catch (e) {
      if (attempt === 1) errors.push("screenshot failed twice: " + String(e && e.message || e).slice(0, 160));
    }
  }
  return null;
}

async function warmUp(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const counter = { count: 0, hosts: [] };
  await stubExternal(page, counter);
  await page.route(spec.apiPattern || "**/api/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }).catch(() => {}));
  const first = (spec.variations || [])[0];
  const p = (first && first.path) || "/";
  const root = base.endsWith(p) && p !== "/" ? base.slice(0, base.length - p.length) : base;
  const started = Date.now();
  try { await page.goto(root + p, { waitUntil: "load", timeout: 120000 }); } catch (e) {}
  await ctx.close().catch(() => {});
  return Date.now() - started;
}
const defaults = spec.defaults || {};
const fallback = spec.fallback === undefined ? { status: 200, json: { success: true, data: [] } } : spec.fallback;

function expand(value, i) {
  if (Array.isArray(value)) {
    const out = [];
    for (const v of value) {
      if (v && typeof v === "object" && !Array.isArray(v) && typeof v.$repeat === "number") {
        for (let k = 0; k < Math.min(v.$repeat, 2000); k++) out.push(expand(v.$item, k));
      } else out.push(expand(v, i));
    }
    return out;
  }
  if (value && typeof value === "object") {
    if (typeof value.$repeat === "number") return expand([value], i);
    const out = {};
    for (const k of Object.keys(value)) out[k] = expand(value[k], i);
    return out;
  }
  if (typeof value === "string" && i !== undefined && value.includes("{{i")) {
    const whole = value.match(/^\{\{i([+*]\d+)?\}\}$/);
    const calc = (op) => (!op ? i : op[0] === "+" ? i + Number(op.slice(1)) : i * Number(op.slice(1)));
    if (whole) return calc(whole[1]);
    return value.replace(/\{\{i([+*]\d+)?\}\}/g, (_m, op) => String(calc(op)));
  }
  return value;
}

const CAPTION_INIT = ({ title }) => {
  const make = () => {
    if (document.getElementById("__uit_caption")) return;
    const el = document.createElement("div");
    el.id = "__uit_caption";
    el.textContent = "▶ " + title;
    el.setAttribute("style", "position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:2147483647;pointer-events:none;max-width:92vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;background:rgba(17,24,39,.88);color:#fff;font:600 14px/1.3 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;padding:7px 14px;border-radius:999px;box-shadow:0 4px 14px rgba(0,0,0,.25)");
    (document.body || document.documentElement).appendChild(el);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", make); else make();
};
const SET_CAPTION = ({ text, hidden }) => {
  const el = document.getElementById("__uit_caption");
  if (!el) return;
  if (text) el.textContent = text;
  el.style.display = hidden ? "none" : "block";
};
const SHOW_TITLE_CARD = ({ title, description, meta }) => {
  const card = document.createElement("div");
  card.id = "__uit_card";
  card.setAttribute("style", "position:fixed;inset:0;z-index:2147483647;pointer-events:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(17,24,39,.92);color:#fff;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;text-align:center;padding:24px");
  const t = document.createElement("div"); t.textContent = title; t.setAttribute("style", "font-size:30px;font-weight:700;max-width:90vw");
  card.appendChild(t);
  if (description) { const d = document.createElement("div"); d.textContent = description; d.setAttribute("style", "font-size:17px;opacity:.85;max-width:80vw"); card.appendChild(d); }
  const m = document.createElement("div"); m.textContent = meta; m.setAttribute("style", "font-size:13px;opacity:.6"); card.appendChild(m);
  const cap = document.getElementById("__uit_caption"); if (cap) cap.style.display = "none";
  (document.body || document.documentElement).appendChild(card);
};
const HIDE_TITLE_CARD = () => { const c = document.getElementById("__uit_card"); if (c) c.remove(); };
const VISIBLE_CONTROLS = () => {
  const seen = new Set();
  const all = [...document.querySelectorAll("button,a,[role=button],[role=tab],[role=link]")];
  const inChrome = (el) => Boolean(el.closest("nav,aside,header,[role=navigation],[role=banner]"));
  for (const el of all.filter((e) => !inChrome(e)).concat(all.filter(inChrome))) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0 || el.closest("#__uit_caption,#__uit_card")) continue;
    const name = (el.getAttribute("aria-label") || el.innerText || el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
    if (name) seen.add(name + (el.disabled || el.getAttribute("aria-disabled") === "true" ? " (disabled)" : ""));
    if (seen.size >= 30) break;
  }
  return [...seen];
};
const IS_DARK = () => {
  if (document.documentElement.classList.contains("dark") || document.body.classList.contains("dark")) return true;
  const c = getComputedStyle(document.body).backgroundColor.match(/\d+(\.\d+)?/g);
  if (!c) return null;
  const [r, g, b] = c.map(Number);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.35;
};
function describeStep(step) {
  if (step.click) return "click " + step.click;
  if (step.fill) return "type into " + step.fill[0];
  if (step.press) return "press " + step.press;
  if (step.hover) return "hover " + step.hover;
  if (step.waitFor) return "wait for " + step.waitFor;
  if (step.wait) return "pause";
  return "step";
}

function matches(rule, req) {
  const u = new URL(req.url());
  const target = u.pathname + u.search;
  if (rule.method && rule.method.toUpperCase() !== req.method()) return false;
  const m = String(rule.match || "");
  if (m.startsWith("re:")) return new RegExp(m.slice(3)).test(target);
  return target.includes(m);
}

async function runVariation(browser, v) {
  const viewport = v.viewport || defaults.viewport || { width: 1440, height: 900 };
  const theme = v.theme || defaults.theme;
  const wantVideo = v.video === true || (spec.video === true && v.video !== false);
  const videoDir = path.join(outDir, "videos", v.id);
  const ctx = await browser.newContext({ viewport, colorScheme: theme === "dark" ? "dark" : "light", ...(wantVideo ? { recordVideo: { dir: videoDir, size: viewport } } : {}) });
  const storage = Object.assign({}, defaults.localStorage || {}, v.localStorage || {});
  if (theme && spec.themeStorageKey) storage[spec.themeStorageKey] = theme;
  if (Object.keys(storage).length) await ctx.addInitScript((s) => { for (const k of Object.keys(s)) localStorage.setItem(k, s[k]); }, storage);
  const title = String(v.title || String(v.id).replace(/[-_]+/g, " ")).slice(0, 120);
  const description = v.description ? String(v.description).slice(0, 220) : "";
  if (wantVideo) await ctx.addInitScript(CAPTION_INIT, { title });
  const page = await ctx.newPage();
  const caption = async (text, hidden) => { if (wantVideo) await page.evaluate(SET_CAPTION, { text, hidden: Boolean(hidden) }).catch(() => {}); };
  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  const unmatched = new Set();
  let apiRequests = 0;
  page.on("console", (m) => { if (m.type() === "error" && consoleErrors.length < 8) consoleErrors.push(m.text().slice(0, 200)); });
  page.on("pageerror", (e) => { if (pageErrors.length < 5) pageErrors.push(String(e && e.message || e).slice(0, 200)); });
  page.on("response", (r) => { if (r.status() >= 400 && failedRequests.length < 10) failedRequests.push(r.status() + " " + new URL(r.url()).pathname); });
  const rules = [].concat(v.mocks || [], defaults.mocks || []);
  const apiPattern = spec.apiPattern || "**/api/**";
  const external = { count: 0, hosts: [] };
  await stubExternal(page, external);
  await page.route(apiPattern, async (route) => {
    const req = route.request();
    apiRequests++;
    const rule = rules.find((r) => matches(r, req));
    if (!rule) {
      unmatched.add(req.method() + " " + new URL(req.url()).pathname);
      if (fallback === "passthrough") return route.continue();
      return route.fulfill({ status: fallback.status || 200, contentType: "application/json", body: JSON.stringify(fallback.json === undefined ? {} : fallback.json) });
    }
    if (rule.delayMs) await new Promise((s) => setTimeout(s, rule.delayMs));
    const body = rule.body !== undefined ? String(rule.body) : JSON.stringify(rule.json === undefined ? {} : expand(rule.json));
    return route.fulfill({ status: rule.status || 200, contentType: rule.contentType || "application/json", body }).catch(() => {});
  });
  const started = Date.now();
  let navError = null;
  const slow = rules.some((r) => r.delayMs);
  try {
    const p = v.path || "/";
    const root = base.endsWith(p) && p !== "/" ? base.slice(0, base.length - p.length) : base;
    await page.goto(root + p, { waitUntil: slow ? "domcontentloaded" : "networkidle", timeout: 30000 });
  } catch (e) { navError = String(e && e.message || e).slice(0, 200); }
  if (wantVideo) {
    const meta = viewport.width + "×" + viewport.height + (theme ? " · " + theme + " theme" : "");
    await page.evaluate(SHOW_TITLE_CARD, { title, description, meta }).catch(() => {});
    await page.waitForTimeout(1800);
    await page.evaluate(HIDE_TITLE_CARD).catch(() => {});
    await caption("▶ " + title);
  }
  const allSteps = v.steps || [];
  for (let i = 0; i < allSteps.length; i++) {
    const step = allSteps[i];
    if (!step.wait) await caption("▶ " + title + " — step " + (i + 1) + "/" + allSteps.length + ": " + describeStep(step));
    try {
      if (step.click) await page.click(step.click, { timeout: 5000 });
      else if (step.fill) await page.fill(step.fill[0], step.fill[1], { timeout: 5000 });
      else if (step.press) await page.keyboard.press(step.press);
      else if (step.hover) await page.hover(step.hover, { timeout: 5000 });
      else if (step.waitFor) await page.waitForSelector(step.waitFor, { timeout: 8000 });
      else if (step.wait) await page.waitForTimeout(step.wait);
    } catch (e) {
      const controls = await page.evaluate(VISIBLE_CONTROLS).catch(() => []);
      pageErrors.push("step " + JSON.stringify(step) + " failed: " + String(e && e.message || e).split("\n")[0].slice(0, 140) + (controls.length ? " | visible buttons/links: " + controls.join(", ") : ""));
    }
  }
  if (allSteps.length) await caption("▶ " + title + " — final state");
  await page.waitForTimeout(v.shotAfterMs === undefined ? (defaults.shotAfterMs === undefined ? 1200 : defaults.shotAfterMs) : v.shotAfterMs);
  const finalUrl = page.url();
  const themeApplied = theme === "dark" ? await page.evaluate(IS_DARK).catch(() => null) : null;
  await caption("", true);
  const shot = path.join(outDir, v.id + ".png");
  const shotPath = await screenshotWithRetry(page, shot, Boolean(v.fullPage), pageErrors);
  let audit = null;
  try { audit = await page.evaluate("(" + AUDIT + ")()"); } catch (e) { audit = { error: String(e).slice(0, 160) }; }
  let textChecks = null;
  const wantTexts = [].concat(v.expectText || []).map((t) => ({ text: String(t), kind: "expect" })).concat([].concat(v.rejectText || []).map((t) => ({ text: String(t), kind: "reject" })));
  if (wantTexts.length) {
    const bodyText = await page.evaluate(() => document.body ? document.body.innerText : "").catch(() => "");
    const norm = (x) => x.replace(/\s+/g, " ").trim();
    const hay = norm(bodyText);
    textChecks = wantTexts.map((w) => {
      const found = w.text.startsWith("re:") ? new RegExp(w.text.slice(3)).test(hay) : hay.includes(norm(w.text));
      return { text: w.text, kind: w.kind, ok: w.kind === "expect" ? found : !found };
    });
  }
  if (wantVideo) { await caption("■ " + title + " — done"); await page.waitForTimeout(900); }
  await page.unrouteAll({ behavior: "ignoreErrors" }).catch(() => {});
  const video = wantVideo && page.video() ? page.video() : null;
  await ctx.close();
  let videoPath = null;
  if (video) {
    try {
      const raw = await video.path();
      videoPath = path.join(outDir, v.id + ".webm");
      fs.renameSync(raw, videoPath);
      fs.rmSync(videoDir, { recursive: true, force: true });
    } catch (e) { pageErrors.push("video save failed: " + String(e && e.message || e).slice(0, 120)); videoPath = null; }
  }
  return { id: v.id, title, path: v.path, finalUrl, themeApplied, textChecks, apiRequests, viewport, theme: theme || "light", screenshot: shotPath, video: videoPath, externalStubbed: external.count, externalHosts: external.hosts, ms: Date.now() - started, navError, audit, consoleErrors, pageErrors, failedRequests, unmatchedRequests: [...unmatched].slice(0, 20), expect: v.expect || null, checks: v.checks || null };
}

(async () => {
  const browser = await playwright.chromium.launch();
  const warmMs = await warmUp(browser);
  const variations = spec.variations || [];
  const results = new Array(variations.length);
  const workers = Math.max(1, Math.min(Number(spec.concurrency) || 8, 10, variations.length));
  let next = 0;
  await Promise.all(Array.from({ length: workers }, async () => {
    while (next < variations.length) {
      const i = next++;
      const v = variations[i];
      try { results[i] = await runVariation(browser, v); }
      catch (e) { results[i] = { id: v.id, error: String(e && e.message || e).slice(0, 300) }; }
    }
  }));
  await browser.close();
  const summary = { ok: true, outDir, count: results.length, warmUpMs: warmMs, results };
  fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ ok: true, outDir, summary: path.join(outDir, "summary.json"), variations: results.map((r) => ({ id: r.id, error: r.error || r.navError || null, pageErrors: (r.pageErrors || []).length, unmatched: (r.unmatchedRequests || []).length })) }));
  process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: String(e && e.stack || e).slice(0, 500) })); process.exit(1); });
`;

export const ENDPOINT_TYPES_SOURCE = String.raw`"use strict";
const fs = require("fs");
const path = require("path");
const [sourceDir, endpointsJson] = [process.argv[2], process.argv[3]];
const endpoints = JSON.parse(fs.readFileSync(endpointsJson, "utf8"));
const MAX_TOTAL = 14000;
const files = [];
(function walk(dir, depth) {
  if (depth > 8 || files.length > 4000) return;
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name.startsWith(".") || e.name === "dist" || e.name === "build") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, depth + 1);
    else if (/\.(ts|tsx|js|jsx)$/.test(e.name) && !/\.(test|spec)\./.test(e.name)) files.push(p);
  }
})(sourceDir, 0);
const cache = new Map();
const read = (f) => { if (!cache.has(f)) { try { cache.set(f, fs.readFileSync(f, "utf8")); } catch (e) { cache.set(f, ""); } } return cache.get(f); };
const isId = (s) => /^(\d+|[0-9a-f-]{16,}|c[a-z0-9]{20,}|u\d+|[A-Za-z0-9_-]{24,})$/.test(s);
function keyFor(p) {
  const segs = p.split("?")[0].split("/").filter(Boolean).filter((s) => !isId(s));
  const v = segs.findIndex((s) => /^v\d+$/.test(s));
  const tail = v >= 0 ? segs.slice(v + 1) : segs.slice(-2);
  return tail.length ? tail.join("/") : null;
}
function block(text, start) {
  let i = text.indexOf("{", start);
  if (i < 0) return text.slice(start, start + 400);
  let depth = 0;
  for (let j = i; j < text.length && j < start + 12000; j++) {
    const c = text[j];
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return text.slice(start, j + 1); }
  }
  return text.slice(start, start + 3000);
}
function enclosingFunction(text, at) {
  const re = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)|(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/g;
  let m, best = null;
  while ((m = re.exec(text)) && m.index <= at) best = m;
  if (!best) return null;
  const code = block(text, best.index);
  if (best.index + code.length < at) return null;
  return { name: best[1] || best[2], code };
}
function typeDef(name, preferred) {
  const re = new RegExp("(?:export\\s+)?(?:interface\\s+" + name + "\\b|type\\s+" + name + "\\s*(?:<[^=]*>)?\\s*=)");
  for (const f of [preferred].concat(files)) {
    if (!f) continue;
    const t = read(f);
    const m = re.exec(t);
    if (!m) continue;
    if (/interface/.test(m[0])) return { file: f, code: block(t, m.index) };
    const end = t.indexOf(";\n", m.index);
    return { file: f, code: t.slice(m.index, end < 0 ? m.index + 800 : Math.min(end + 1, m.index + 2500)) };
  }
  return null;
}
const SKIP = new Set(["Promise", "Record", "Partial", "Array", "Date", "Error", "Response", "RequestInit", "URLSearchParams", "Pick", "Omit", "Readonly", "Map", "Set", "JSON", "Number", "String", "Boolean", "Object"]);
const out = {};
let total = 0;
for (const ep of endpoints) {
  const key = keyFor(ep);
  if (!key) continue;
  const occ = new RegExp("/" + key.replace(/[.*+?^()|[\]\\{}$]/g, "\\$&") + "(?=[\x60'\"?$/)])", "g");
  const ordered = files.filter((f) => /api|client|service/i.test(path.basename(f))).concat(files.filter((f) => !/api|client|service/i.test(path.basename(f))));
  let hit = null, fn = null, at = -1;
  for (const f of ordered) {
    const t = read(f);
    if (!t.includes(key)) continue;
    occ.lastIndex = 0;
    let m;
    while ((m = occ.exec(t))) {
      const cand = enclosingFunction(t, m.index);
      if (cand && /fetch\(|request[<(]|axios|\.get\(|\.post\(/.test(cand.code)) { hit = f; fn = cand; at = m.index; break; }
      if (!hit) { hit = f; at = m.index; }
    }
    if (fn) break;
  }
  if (!hit) { out[ep] = { key, found: false }; continue; }
  const text = read(hit);
  const entry = { key, file: path.relative(sourceDir, hit), function: fn ? fn.name : null, code: fn ? fn.code.slice(0, 2500) : text.slice(Math.max(0, at - 300), at + 600), types: {} };
  const seen = new Set();
  let queue = [...new Set((entry.code.match(/\b[A-Z][A-Za-z0-9]+\b/g) || []).filter((n) => !SKIP.has(n)))];
  for (let depth = 0; depth < 3 && queue.length; depth++) {
    const nextQ = [];
    for (const n of queue) {
      if (seen.has(n) || Object.keys(entry.types).length >= 10) continue;
      seen.add(n);
      const d = typeDef(n, hit);
      if (!d) continue;
      entry.types[n] = d.code.slice(0, 1800);
      for (const m of d.code.match(/\b[A-Z][A-Za-z0-9]+\b/g) || []) if (!SKIP.has(m) && !seen.has(m)) nextQ.push(m);
    }
    queue = [...new Set(nextQ)];
  }
  const size = JSON.stringify(entry).length;
  if (total + size > MAX_TOTAL) { out[ep] = { key, file: entry.file, function: entry.function, truncated: true }; continue; }
  total += size;
  out[ep] = entry;
}
const themeKeys = new Set();
for (const f of files) {
  const t = read(f);
  if (!/localStorage/.test(t)) continue;
  const re = /localStorage\.(?:getItem|setItem)\(\s*["'\x60]([^"'\x60]*theme[^"'\x60]*)["'\x60]/gi;
  let m;
  while ((m = re.exec(t))) themeKeys.add(m[1]);
  const c = /(?:STORAGE_KEY|THEME_KEY|themeKey)\s*=\s*["'\x60]([^"'\x60]+)["'\x60]/g;
  while ((m = c.exec(t))) if (/theme/i.test(m[1]) || /theme/i.test(f)) themeKeys.add(m[1]);
}
out.__themeKeys = [...themeKeys].slice(0, 5);
console.log(JSON.stringify(out));
`;
