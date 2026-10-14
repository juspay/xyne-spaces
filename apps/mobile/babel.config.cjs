/**
 * Jest runs modules as CommonJS, but babel-preset-expo leaves `import()`
 * untouched because jest's babel caller advertises dynamic-import support
 * (which only holds under `--experimental-vm-modules`). Under the test env,
 * rewrite `import(x)` to `Promise.resolve().then(() => require(x))` so lazily
 * loaded screens (e.g. `src/features/channel-tickets/load.ts`) can be exercised
 * by rendering tests. Metro never runs with NODE_ENV=test, so app bundles are
 * unaffected.
 */
const dynamicImportToRequire = ({ types: t }) => ({
  name: 'test-env-dynamic-import-to-require',
  visitor: {
    CallExpression(path) {
      if (!t.isImport(path.node.callee)) return;
      const [specifier] = path.node.arguments;
      if (!specifier) return;
      path.replaceWith(
        t.callExpression(
          t.memberExpression(
            t.callExpression(
              t.memberExpression(t.identifier('Promise'), t.identifier('resolve')),
              [],
            ),
            t.identifier('then'),
          ),
          [t.arrowFunctionExpression([], t.callExpression(t.identifier('require'), [specifier]))],
        ),
      );
    },
  },
});

module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    env: {
      test: {
        plugins: [dynamicImportToRequire],
      },
    },
  };
};
