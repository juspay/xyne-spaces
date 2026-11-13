/**
 * Wrap the built stylesheet in a CSS cascade layer.
 *
 * A component library shares a document with its host, and both may define the
 * same selectors — two Tailwind builds each ship `.flex`, `.p-4`, `.bg-primary`.
 * Unlayered, the winner is decided by import order, so whichever stylesheet the
 * host happens to import second silently restyles the other. That is not
 * something a host should have to know or manage.
 *
 * In the cascade, unlayered styles beat layered ones regardless of specificity
 * or source order. Putting our output in a layer makes the host win every tie by
 * default: it can override anything here without `!important`, extra specificity
 * or a particular import position, while our rules still apply wherever the host
 * defines nothing.
 *
 * Deliberate deference — this package is themed by its host (see the `--wui-*`
 * tokens), so "the app wins" is the behaviour we want.
 *
 * Run as a post-build step rather than a postcss plugin: the Tailwind CLI does
 * not reliably apply plugins declared in postcss.config.js, and silently
 * emitting an unwrapped stylesheet is exactly the failure this guards against.
 */
import { readFile, writeFile } from 'node:fs/promises';

const LAYER = 'workflow-ui';
const FILE = new URL('../dist/styles.css', import.meta.url);

const css = await readFile(FILE, 'utf8');

if (css.trimStart().startsWith(`@layer ${LAYER}`)) {
  console.log(`[wrap-css-layer] already wrapped, nothing to do`);
  process.exit(0);
}

// @charset and @import are only legal at the very top of a stylesheet, so they
// stay outside the layer. Tailwind inlines imports at build time, so in practice
// there are none — this keeps the script correct if that changes.
const pinned = [];
let body = css;
const leading = /^\s*@(charset|import)[^;]*;/i;
for (;;) {
  const match = body.match(leading);
  if (!match) break;
  pinned.push(match[0].trim());
  body = body.slice(match[0].length);
}

// ── Unlayered tail — restore button fills the host's Preflight would blank ──
//
// Tailwind's Preflight (shipped by the host, UNLAYERED) resets
//   button,[type=button],[type=reset],[type=submit]{ background-color: transparent }
// and an unlayered declaration beats every declaration in a cascade layer whatever
// its specificity. So every background utility we emit — all inside @layer above —
// loses on `<button>` elements, and primary CTAs render with no fill (the "plain
// text button" bug). We can't relayer the host's Preflight, so we re-assert the
// button *fill* utilities OUTSIDE the layer: they then tie with Preflight on layer
// and win on specificity.
//
// Scoped to `button.<fill-class>` on purpose — ghost / icon buttons carry no fill
// utility, so they keep Preflight's transparent default and no native button-face
// leaks back in. Hover-fill is re-asserted too; hover-*opacity* needs nothing
// (Preflight doesn't touch opacity, so the layered utility still applies).
const UNLAYERED_TAIL = [
  '[data-workflow-ui] button.bg-\\[var\\(--wui-primary\\)\\]{background-color:var(--wui-primary)}',
  '[data-workflow-ui] button.hover\\:bg-\\[var\\(--wui-primary\\)\\]:hover{background-color:var(--wui-primary)}',
  '[data-workflow-ui] button.hover\\:bg-\\[var\\(--wui-primary-hover\\)\\]:hover{background-color:var(--wui-primary-hover)}',
  '[data-workflow-ui] button.bg-primary{background-color:hsl(var(--primary))}',
  '[data-workflow-ui] button.hover\\:bg-primary\\/90:hover{background-color:hsl(var(--primary) / 0.9)}',
].join('');

const wrapped = `${pinned.join('')}@layer ${LAYER}{${body.trim()}}${UNLAYERED_TAIL}`;
await writeFile(FILE, wrapped);
console.log(
  `[wrap-css-layer] wrapped dist/styles.css in @layer ${LAYER}`
  + ` (+ unlayered button-fill tail)`
  + `${pinned.length ? ` (${String(pinned.length)} at-rule(s) kept outside)` : ''}`,
);
