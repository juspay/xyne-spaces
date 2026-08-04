// Test-only stub for @xyne/shared.
// The real package ships ESM (dist) and pulls the @rocicorp/zero ESM graph, which
// the CJS jest runtime cannot evaluate. The invitation-accept code path only uses
// TYPES from @xyne/shared (erased at runtime), so a recursive Proxy that answers any
// property access with a callable proxy is a safe stand-in for module evaluation.
const handler = {
  get(_target, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return proxy;
    // eslint-disable-next-line no-use-before-define
    return proxy;
  },
  apply() {
    // eslint-disable-next-line no-use-before-define
    return proxy;
  },
};
const proxy = new Proxy(function stub() {}, handler);
module.exports = proxy;
