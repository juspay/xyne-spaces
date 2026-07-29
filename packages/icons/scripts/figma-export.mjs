#!/usr/bin/env node
/**
 * Bulk-exports Pikaicons SVGs from a Figma file via the REST API.
 *
 *   enumerate document tree  →  find icon containers (nodes with "Style=*" children)
 *        →  batch-render each Style node to SVG  →  download to svg/<icon>/<Style>.svg
 *
 * Then run `npm run build:icons` to turn those into typed components.
 *
 * Usage:
 *   node scripts/figma-export.mjs [--file=KEY] [--limit=N] [--force]
 *                                 [--batch=80] [--concurrency=8] [--dry]
 *
 * --dry    enumerate + write manifest only, no rendering/downloading
 * --limit  only export the first N icons (for a quick validation run)
 * --force  re-download even if the svg file already exists (default: skip existing)
 *
 * Token: read from FIGMA_TOKEN (env) or icons/.env.local. Never hard-code it.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG_DIR = join(ROOT, "svg");
const API = "https://api.figma.com/v1";

// The 5 canonical styles → output filename (must match build-icons.mjs STYLE_FILES).
const STYLE_FILE = {
  Stroke: "Stroke",
  Solid: "Solid",
  Contrast: "Contrast",
  "Duo Stroke": "DuoStroke",
  "Duo Solid": "DuoSolid",
};

// ---- args & token ----------------------------------------------------------
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v ?? true];
  }),
);
const FILE_KEY = args.file || "6wvX7VR9TnQhU6EpyDFLzo";
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const BATCH = args.batch ? Number(args.batch) : 80;
const CONCURRENCY = args.concurrency ? Number(args.concurrency) : 8;
const FORCE = Boolean(args.force);
const DRY = Boolean(args.dry);

function loadToken() {
  if (process.env.FIGMA_TOKEN) return process.env.FIGMA_TOKEN;
  try {
    const env = readFileSync(join(ROOT, ".env.local"), "utf8");
    const m = env.match(/^\s*FIGMA_TOKEN\s*=\s*(.+?)\s*$/m);
    if (m) return m[1].replace(/^["']|["']$/g, "");
  } catch {}
  console.error("Missing FIGMA_TOKEN (env or icons/.env.local).");
  process.exit(1);
}
const TOKEN = loadToken();
const headers = { "X-Figma-Token": TOKEN };

// ---- helpers ---------------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchJson(url, tries = 5) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
      if (res.status === 429 || res.status >= 500) {
        const wait = Number(res.headers.get("retry-after")) * 1000 || 2000 * (i + 1);
        console.warn(`  ${res.status} — backing off ${wait}ms`);
        await sleep(wait);
        continue;
      }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
      return res.json();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1500 * (i + 1)); // transient connect/timeout — retry
    }
  }
  throw new Error(`Exhausted retries for ${url}`);
}

/** Download a render URL to text, retrying transient connect/timeout errors. */
async function downloadText(url, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
      if (!res.ok) throw new Error(`${res.status}`);
      return await res.text();
    } catch (e) {
      if (i === tries - 1) throw e;
      await sleep(1000 * (i + 1));
    }
  }
}

/** slugify a Figma name like "photo-image/photo-image-ai" → "photo-image-ai". */
const slug = (name) =>
  (name || "")
    .split("/")
    .pop()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Walk the doc tree; an "icon" is any node with ≥1 child named "Style=…".
 * `section` tracks the nearest ancestor SECTION name — the Figma file's visual
 * grouping (e.g. "Web3 & Crypto", "Ai") — used as the icon's category.
 */
function collectIcons(node, out, section = "") {
  if (node.type === "SECTION" && node.name) section = node.name.trim();
  const kids = node.children || [];
  const styleKids = kids.filter((c) => typeof c.name === "string" && c.name.startsWith("Style="));
  if (styleKids.length) {
    const styles = {};
    for (const c of styleKids) {
      const styleName = c.name.slice("Style=".length).trim();
      if (STYLE_FILE[styleName]) styles[styleName] = c.id;
    }
    if (Object.keys(styles).length) {
      out.push({
        rawName: node.name,
        section: section || "Other",
        category: slug(section) || "other",
        slug: slug(node.name),
        styles,
      });
    }
  }
  for (const c of kids) collectIcons(c, out, section);
  return out;
}

/** Resolve slug collisions deterministically by prefixing the category. */
function dedupe(icons) {
  const bySlug = new Map();
  for (const ic of icons) (bySlug.get(ic.slug) ?? bySlug.set(ic.slug, []).get(ic.slug)).push(ic);
  const clashes = [];
  for (const [s, group] of bySlug) {
    if (group.length > 1) {
      for (const ic of group) ic.slug = ic.category ? `${ic.category}-${ic.slug}` : ic.slug;
      clashes.push(s);
    }
  }
  // second pass in case category-prefixing still collides → numeric suffix
  const seen = new Set();
  for (const ic of icons) {
    let s = ic.slug, n = 2;
    while (seen.has(s)) s = `${ic.slug}-${n++}`;
    ic.slug = s;
    seen.add(s);
  }
  return clashes;
}

async function pool(items, n, worker) {
  const queue = [...items.entries()];
  const runners = Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) {
      const [i, item] = queue.shift();
      await worker(item, i);
    }
  });
  await Promise.all(runners);
}

// ---- main ------------------------------------------------------------------
async function main() {
  console.log(`Fetching document tree for ${FILE_KEY} …`);
  const doc = await fetchJson(`${API}/files/${FILE_KEY}?geometry=paths`);
  const icons = collectIcons(doc.document, []);
  const clashes = dedupe(icons);
  console.log(`Found ${icons.length} icons (${icons.reduce((a, i) => a + Object.keys(i.styles).length, 0)} style nodes).`);
  if (clashes.length) console.log(`  ${clashes.length} name collision(s) resolved by category prefix, e.g. ${clashes.slice(0, 5).join(", ")}`);

  mkdirSync(SVG_DIR, { recursive: true });
  writeFileSync(join(SVG_DIR, "manifest.json"), JSON.stringify(icons, null, 2));
  console.log(`Wrote manifest → svg/manifest.json`);

  const targets = icons.slice(0, LIMIT);
  if (DRY) {
    console.log(`--dry: enumerated ${targets.length} icons, skipping render/download.`);
    return;
  }

  // Flatten to work items, skipping ones already on disk (unless --force).
  const work = [];
  for (const ic of targets) {
    for (const [styleName, nodeId] of Object.entries(ic.styles)) {
      const file = join(SVG_DIR, ic.slug, `${STYLE_FILE[styleName]}.svg`);
      if (!FORCE && existsSync(file)) continue;
      work.push({ nodeId, file });
    }
  }
  console.log(`${work.length} SVGs to fetch (batch=${BATCH}, concurrency=${CONCURRENCY})…`);

  let done = 0;
  const failed = [];
  for (let i = 0; i < work.length; i += BATCH) {
    const chunk = work.slice(i, i + BATCH);
    const ids = chunk.map((w) => w.nodeId).join(",");
    const { images, err } = await fetchJson(
      `${API}/images/${FILE_KEY}?ids=${encodeURIComponent(ids)}&format=svg`,
    );
    if (err) throw new Error(`images error: ${err}`);
    await pool(chunk, CONCURRENCY, async (w) => {
      const url = images[w.nodeId];
      if (!url) {
        console.warn(`  no render URL for ${w.nodeId} (${w.file}) — skipping`);
        return;
      }
      try {
        const svg = await downloadText(url);
        mkdirSync(dirname(w.file), { recursive: true });
        writeFileSync(w.file, svg);
        done++;
      } catch (e) {
        failed.push(w);
        console.warn(`  download failed for ${w.file}: ${e.message}`);
      }
    });
    console.log(`  ${Math.min(i + BATCH, work.length)}/${work.length}`);
    await sleep(300); // gentle pacing between render batches
  }
  console.log(`\n✓ Downloaded ${done} SVGs → svg/.`);
  if (failed.length) {
    console.log(`  ⚠ ${failed.length} failed — re-run the same command to retry just those (existing files are skipped).`);
  }
  console.log(`Next: npm run build:icons`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
