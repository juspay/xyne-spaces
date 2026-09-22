#!/usr/bin/env node
/**
 * WCAG 1.4.3 (Contrast, AA) / 1.4.11 (Non-text Contrast, AA) audit of the theme
 * tokens in src/global.css.
 *
 * Pure Node, no dependencies, no browser — it reads the `--token: <colour>`
 * declarations out of each `[data-theme="..."]` block and computes the WCAG
 * contrast ratio for the pairs the design system actually composes.
 *
 * It cannot catch a contrast failure produced by a hardcoded colour inside a
 * component, only by the tokens. It exists so that a token change which breaks
 * contrast is caught in review rather than by a user who cannot read the text.
 *
 *   node scripts/a11y-contrast-audit.mjs           # report
 *   node scripts/a11y-contrast-audit.mjs --strict  # exit 1 on any failure
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CSS = resolve(here, '../src/global.css');

/** [foreground token, background token, minimum ratio, what it is]. */
const PAIRS = [
  ['foreground', 'background', 4.5, 'body text'],
  ['muted-foreground', 'background', 4.5, 'secondary text'],
  ['muted-foreground', 'muted', 4.5, 'secondary text on muted fill'],
  ['card-foreground', 'card', 4.5, 'text on cards'],
  ['popover-foreground', 'popover', 4.5, 'text in popovers'],
  ['primary-foreground', 'primary', 4.5, 'primary button label'],
  ['secondary-foreground', 'secondary', 4.5, 'secondary button label'],
  ['accent-foreground', 'accent', 4.5, 'accent label'],
  ['destructive-foreground', 'destructive', 4.5, 'destructive button label'],
  ['warning-foreground', 'warning', 4.5, 'warning label'],
  ['border', 'background', 3, 'component borders (non-text)'],
  ['input', 'background', 3, 'input outlines (non-text)'],
  ['ring', 'background', 3, 'focus indicator (non-text)'],
  ['focus-ring', 'background', 3, 'focus-visible fallback ring (non-text)'],
];

function parseThemes(css) {
  const themes = {};
  const re = /\[data-theme=["']([^"']+)["']\]\s*\{([^}]*)\}/g;
  let m;
  while ((m = re.exec(css))) {
    const [, name, body] = m;
    const tokens = themes[name] ?? (themes[name] = {});
    const decl = /--([a-z0-9-]+)\s*:\s*([^;]+);/gi;
    let d;
    while ((d = decl.exec(body))) {
      tokens[d[1]] = d[2]
        .trim()
        .replace(/\/\*.*$/, '')
        .trim();
    }
  }
  return themes;
}

function toRgb(value) {
  if (!value) {
    return null;
  }
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map(c => c + c).join('') : hex[1];
    return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16));
  }
  // Tailwind / shadcn store bare HSL triples: "240 5.9% 90%".
  const hsl = value.match(/^(-?[\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/);
  if (!hsl) {
    return null;
  }
  const [h, s, l] = [Number(hsl[1]), Number(hsl[2]) / 100, Number(hsl[3]) / 100];
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(((((h % 360) + 360) % 360) / 60));
  const seg = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];
  return seg.map(v => Math.round((v + m) * 255));
}

const luminance = rgb =>
  rgb
    .map(v => v / 255)
    .map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
    .reduce((acc, v, i) => acc + v * [0.2126, 0.7152, 0.0722][i], 0);

const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

const themes = parseThemes(readFileSync(CSS, 'utf8'));
let failures = 0;
let skipped = 0;

for (const [theme, tokens] of Object.entries(themes)) {
  const rows = [];
  for (const [fg, bg, min, label] of PAIRS) {
    const a = toRgb(tokens[fg]);
    const b = toRgb(tokens[bg]);
    if (!a || !b) {
      skipped += 1;
      continue;
    }
    const ratio = contrast(a, b);
    const pass = ratio >= min;
    if (!pass) {
      failures += 1;
    }
    rows.push(
      `  ${pass ? 'PASS' : 'FAIL'}  ${ratio.toFixed(2).padStart(6)}:1  (min ${min})  --${fg} on --${bg}  - ${label}`,
    );
  }
  if (rows.length) {
    console.log(`\n[data-theme="${theme}"]`);
    console.log(rows.join('\n'));
  }
}

console.log(
  `\n${failures} contrast failure(s)${skipped ? `, ${skipped} pair(s) skipped (token missing or not a plain HSL/hex value)` : ''}.`,
);

if (process.argv.includes('--strict') && failures > 0) {
  process.exit(1);
}
