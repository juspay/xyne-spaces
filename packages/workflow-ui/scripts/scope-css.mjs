/**
 * Scope every selector this package emits under `[data-workflow-ui]`.
 *
 * Isolation by construction: a rule that cannot match outside the attribute can
 * never restyle a host's elements, however the two stylesheets are ordered and
 * whatever class names they happen to share. That is stronger than the cascade
 * layer this runs alongside — the layer decides who wins a shared name, this
 * removes the sharing.
 *
 * Why this attribute rather than a wrapper class: the package portals dialogs,
 * popovers and previews to `document.body`, where a wrapper ancestor does not
 * exist. Every portal root already stamps `data-workflow-ui` — it had to, or the
 * `--wui-*` tokens would resolve to nothing there — so the anchor is already in
 * the DOM exactly where scoping needs it, and no portal has to change.
 *
 * Two forms are emitted per rule because the stamped element usually carries
 * utilities itself:
 *
 *     .flex{…}  ->  [data-workflow-ui] .flex, [data-workflow-ui].flex { … }
 */
import { readFile, writeFile } from 'node:fs/promises';
import postcss from 'postcss';

const SCOPE = '[data-workflow-ui]';
const FILE = new URL('../dist/styles.css', import.meta.url);

/** Rules whose selector addresses the document, not content inside the scope. */
const DOCUMENT_LEVEL = new Set([':root', 'html', 'body', ':host', ':host,html', 'html,:host']);

const scope = () => ({
  postcssPlugin: 'scope-to-attribute',
  OnceExit(root) {
    root.walkRules((rule) => {
      // Keyframe steps ("from", "to", "50%") are not selectors.
      if (rule.parent?.type === 'atrule' && /keyframes$/i.test(rule.parent.name)) return;

      rule.selectors = rule.selectors.flatMap((sel) => {
        const s = sel.trim();
        if (!s || s.includes(SCOPE)) return [s];

        // `:root`/`html`/`body` declare document-level things — most often the
        // custom properties the package's own components read. Re-point them at
        // the scope element so the values still resolve, without the package
        // asserting anything about the host's document.
        if (DOCUMENT_LEVEL.has(s)) return [SCOPE];

        // Descendant form for content inside the scope, compound form for the
        // stamped element itself. In the compound form a leading type or
        // universal selector must come first — `[data-workflow-ui]*` is invalid
        // CSS, and one invalid selector drops the whole rule (which silently
        // lost Tailwind's `--tw-*` defaults, and with them every transform and
        // ring, in any host without its own Tailwind base).
        const lead = /^(\*|[a-zA-Z][\w-]*)(.*)$/.exec(s);
        return [`${SCOPE} ${s}`, lead ? `${lead[1]}${SCOPE}${lead[2]}` : `${SCOPE}${s}`];
      });
    });
  },
});
scope.postcss = true;

// Re-running is safe — the per-selector guard above skips anything already
// scoped — so report what actually changed rather than guessing from the file's
// first bytes, which the cascade-layer wrapper may already have rewritten.
const css = await readFile(FILE, 'utf8');
const out = await postcss([scope()]).process(css, { from: undefined });
if (out.css === css) {
  console.log('[scope-css] already scoped, nothing to do');
} else {
  await writeFile(FILE, out.css);
  console.log(`[scope-css] scoped dist/styles.css under ${SCOPE}`);
}
