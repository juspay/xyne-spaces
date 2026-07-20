#!/usr/bin/env node
/**
 * Generates typed React icon components from raw Figma SVG exports.
 *
 * Pipeline:
 *   svg/<icon-name>/<Style>.svg   (raw Figma exports, 5 per icon)
 *        │  parse → keep only the <g id="Style=…"> subtree
 *        │  flatten to [tag, attrs] tuples, propagate group opacity
 *        │  #111111 → currentColor, drop inherited stroke-* attrs
 *        ▼
 *   src/icons/<icon-name>.ts      (IconVariants + createPikaIcon call)
 *   src/index.ts                  (barrel, regenerated)
 *
 * Run:  npm run build:icons
 */
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SVG_DIR = join(ROOT, "svg");
const OUT_DIR = join(ROOT, "src", "icons");

/** slug → { section, category } from the export manifest (for grouping metadata). */
function loadManifestMeta() {
  try {
    const m = JSON.parse(readFileSync(join(SVG_DIR, "manifest.json"), "utf8"));
    return new Map(m.map((i) => [i.slug, { section: i.section || "Other", category: i.category || "other" }]));
  } catch {
    return new Map();
  }
}

// Maps a source filename (sans .svg) to the canonical style key.
const STYLE_FILES = {
  Stroke: "Stroke",
  Solid: "Solid",
  Contrast: "Contrast",
  DuoStroke: "Duo Stroke",
  DuoSolid: "Duo Solid",
};

const SHAPE_TAGS = ["path", "circle", "rect", "line", "ellipse", "polygon", "polyline"];
const PRIMARY_COLORS = new Set(["#111111", "#111", "#000000", "#000", "black"]);
// Attrs that live on the <svg> root and are inherited — strip from paths.
const INHERITED = new Set(["stroke-width", "stroke-linecap", "stroke-linejoin", "id"]);

const normColor = (v) => (PRIMARY_COLORS.has(v.toLowerCase()) ? "currentColor" : v);
const round = (n) => Math.round(n * 100) / 100;

const pascal = (s) =>
  s
    .replace(/[^a-zA-Z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : ""))
    .replace(/^(.)/, (c) => c.toUpperCase());
const camel = (s) => pascal(s).replace(/^(.)/, (c) => c.toLowerCase());

const readAttrs = (tag) => {
  const attrs = {};
  for (const [, k, v] of tag.matchAll(/([a-zA-Z-]+)="([^"]*)"/g)) attrs[k] = v;
  return attrs;
};

/**
 * Extracts leaf shapes from the `Style=` group, propagating group opacity, and
 * returns an ordered list of [tag, attrs] tuples ready to serialize.
 */
function parseSvg(svg, keyPrefix) {
  // REST `/images` exports render the node cleanly: shapes are direct <svg>
  // children, no artboard chrome. Drop non-drawing defs (gradients/masks/clips)
  // and collect every shape, honoring opacity from any wrapping <g>.
  const body = svg.replace(/<defs[\s\S]*?<\/defs>/gi, "");
  const tokens = body.matchAll(
    /<g\b[^>]*?>|<\/g>|<(?:path|circle|rect|line|ellipse|polygon|polyline)\b[^>]*?\/?>/g,
  );

  const opacityStack = []; // effective opacity contributed by open <g> ancestors
  const nodes = [];
  let i = 0;

  for (const m of tokens) {
    const t = m[0];
    if (t === "</g>") {
      opacityStack.pop();
      continue;
    }
    if (t.startsWith("<g")) {
      const o = readAttrs(t).opacity;
      opacityStack.push(o != null ? Number(o) : 1);
      continue;
    }
    // shape element
    const raw = readAttrs(t);
    const tag = t.match(/^<(\w+)/)[1];
    const groupOpacity = opacityStack.reduce((a, b) => a * b, 1);
    const eff = groupOpacity * (raw.opacity != null ? Number(raw.opacity) : 1);

    const attrs = {};
    if (raw.d) attrs.d = raw.d;
    for (const k of ["cx", "cy", "r", "x", "y", "width", "height", "x1", "y1", "x2", "y2", "points", "rx", "ry"]) {
      if (raw[k] != null) attrs[k] = raw[k];
    }
    if (raw.fill != null && raw.fill !== "none") attrs.fill = normColor(raw.fill);
    if (raw.stroke != null && raw.stroke !== "none") attrs.stroke = normColor(raw.stroke);
    if (raw["fill-rule"]) attrs.fillRule = raw["fill-rule"];
    if (raw["clip-rule"]) attrs.clipRule = raw["clip-rule"];
    if (eff < 1) attrs.opacity = round(eff);
    for (const k of Object.keys(raw)) void INHERITED.has(k); // documented: intentionally dropped

    attrs.key = `${keyPrefix}${i++}`;
    nodes.push([tag, attrs]);
  }
  if (!nodes.length) throw new Error("no drawable shapes found");
  return nodes;
}

const serializeNode = ([tag, attrs]) =>
  `["${tag}", ${JSON.stringify(attrs)}]`;

function buildIcon(name) {
  const dir = join(SVG_DIR, name);
  const variants = {};
  for (const [file, styleKey] of Object.entries(STYLE_FILES)) {
    const p = join(dir, `${file}.svg`);
    let svg;
    try {
      svg = readFileSync(p, "utf8");
    } catch {
      continue; // style not exported for this icon — filled via fallback below
    }
    try {
      variants[styleKey] = parseSvg(svg, styleKey[0].toLowerCase());
    } catch (e) {
      console.warn(`  ⚠ ${name}/${file}.svg unparseable (${e.message}) — skipping "${styleKey}"`);
    }
  }

  const present = Object.keys(variants);
  if (!present.length) {
    console.warn(`  ⚠ ${name} has no usable styles — skipping`);
    return null;
  }

  // Guarantee all 5 styles so the component's API is uniform and IconVariants is
  // satisfied. Missing styles fall back to the nearest available (Stroke first).
  const ALL_STYLES = ["Stroke", "Solid", "Contrast", "Duo Stroke", "Duo Solid"];
  const fallback = variants.Stroke ?? variants.Solid ?? variants[present[0]];
  const missing = ALL_STYLES.filter((s) => !variants[s]);
  for (const s of missing) variants[s] = fallback;

  const comp = pascal(name);
  const local = camel(name);
  const body = ALL_STYLES.map(
    (k) => `  "${k}": [\n${variants[k].map((n) => `    ${serializeNode(n)},`).join("\n")}\n  ],`,
  ).join("\n");

  const out = `// AUTO-GENERATED by scripts/build-icons.mjs — do not edit by hand.
import { createPikaIcon } from "../createPikaIcon.js";
import type { IconVariants } from "../types.js";

const ${local}: IconVariants = {
${body}
};

export const ${comp} = createPikaIcon("${name}", ${local});
export default ${comp};
`;
  writeFileSync(join(OUT_DIR, `${name}.ts`), out);
  return { comp, missing };
}

/** Emits src/meta.ts: per-icon { component, name, section, category } + section order. */
function writeMeta(comps) {
  const rows = comps
    .map(
      (c) =>
        `  { component: "${c.comp}", name: "${c.name}", section: ${JSON.stringify(c.section)}, category: "${c.category}" },`,
    )
    .join("\n");
  // Preserve Figma section order by first appearance, but sort by size desc for a
  // stable, sensible default; consumers can regroup however they like.
  const counts = {};
  for (const c of comps) counts[c.section] = (counts[c.section] || 0) + 1;
  const sections = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));

  const out = `// AUTO-GENERATED by scripts/build-icons.mjs — do not edit by hand.
export interface IconMeta {
  /** Exported component name, e.g. "HomeAi" (key into the package's named exports). */
  component: string;
  /** Kebab-case icon id, e.g. "home-ai". */
  name: string;
  /** Human-readable Figma section, e.g. "Ai", "Web3 & Crypto". */
  section: string;
  /** Slugified section, e.g. "ai", "web3-crypto". */
  category: string;
}

/** Every icon's metadata, aligned with the package's named exports. */
export const ICON_META: IconMeta[] = [
${rows}
];

/** Section names, ordered by icon count (desc). */
export const ICON_SECTIONS: string[] = ${JSON.stringify(sections, null, 0)};
`;
  writeFileSync(join(ROOT, "src", "meta.ts"), out);
}

function main() {
  const iconDirs = readdirSync(SVG_DIR).filter((d) => statSync(join(SVG_DIR, d)).isDirectory());
  if (!iconDirs.length) {
    console.error("No icon folders found under svg/");
    process.exit(1);
  }
  const meta = loadManifestMeta();
  const comps = [];
  const incomplete = [];
  const verbose = iconDirs.length <= 25;
  for (const name of iconDirs.sort()) {
    if (verbose) console.log(`• ${name}`);
    const res = buildIcon(name);
    if (!res) continue;
    const m = meta.get(name) ?? { section: "Other", category: "other" };
    comps.push({ name, comp: res.comp, section: m.section, category: m.category });
    if (res.missing.length) incomplete.push({ name, missing: res.missing });
  }

  const barrel =
    comps.map(({ name, comp }) => `export { ${comp} } from "./icons/${name}.js";`).join("\n") +
    `\nexport { createPikaIcon } from "./createPikaIcon.js";\n` +
    `export { ICON_META, ICON_SECTIONS } from "./meta.js";\n` +
    `export type { IconMeta } from "./meta.js";\n` +
    `export type { IconNode, IconVariants, PikaStyle, PikaIconProps } from "./types.js";\n` +
    `export { PIKA_STYLES } from "./types.js";\n`;
  writeFileSync(join(ROOT, "src", "index.ts"), barrel);
  writeMeta(comps);

  console.log(`\n✓ Generated ${comps.length} icon(s) → src/icons/, regenerated src/index.ts + src/meta.ts`);
  if (incomplete.length) {
    console.log(
      `  ⚠ ${incomplete.length} icon(s) missing some styles (filled via fallback), e.g. ` +
        incomplete.slice(0, 5).map((i) => `${i.name}[${i.missing.join(",")}]`).join("; "),
    );
    writeFileSync(join(ROOT, "incomplete-icons.json"), JSON.stringify(incomplete, null, 2));
  }
}

main();
