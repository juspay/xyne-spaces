export default {
  plugins: {
    tailwindcss: {},
    // Flattens `:is(.a, .b) p` into `.a p, .b p` (specificity preserved). Chrome's
    // ancestor bloom filter can't see through `:is()`, so the unexpanded form walks
    // every ancestor of every candidate element on each style recalc.
    '@csstools/postcss-is-pseudo-class': { preserve: false },
    autoprefixer: {},
  },
};
