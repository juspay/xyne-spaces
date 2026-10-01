import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import isPseudoClass from '@csstools/postcss-is-pseudo-class';

// Our own stylesheet only: third-party CSS (workflow-ui, BlockNote, pdf.js) is
// shipped as-is and some of it nests `:is()` beyond what the plugin can parse.
const onlyGlobalCss = plugin => ({
  postcssPlugin: `${plugin.postcssPlugin}-global-css-only`,
  prepare(result) {
    return (result.opts.from ?? '').endsWith('/src/global.css') ? plugin.prepare(result) : {};
  },
});

export default {
  plugins: [
    tailwindcss,
    // Flattens `:is(.a, .b) p` into `.a p, .b p` (specificity preserved). Chrome's
    // ancestor bloom filter can't see through `:is()`, so the unexpanded form walks
    // every ancestor of every candidate element on each style recalc.
    onlyGlobalCss(isPseudoClass({ preserve: false })),
    autoprefixer,
  ],
};
