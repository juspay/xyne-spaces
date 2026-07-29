/**
 * ESLint rule to enforce using axios instead of fetch API
 *
 * This rule prevents the usage of fetch() and recommends using axios for HTTP requests.
 * It helps standardize HTTP client usage across the codebase and provides better
 * consistency for request/response handling, interceptors, and error handling.
 *
 * @example
 * // ❌ Invalid - using fetch
 * fetch('/api/users')
 * window.fetch('/api/users')
 * globalThis.fetch('/api/users')
 *
 * // ✅ Valid - using axios
 * axios.get('/api/users')
 * axios.post('/api/users', data)
 */

module.exports = {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Enforce using axios instead of fetch API',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null, // This rule doesn't provide auto-fixes
    messages: {
      noFetch: 'Use axios instead of fetch() for HTTP requests. Import axios and use axios.get(), axios.post(), etc.',
      noGlobalFetch: 'Use axios instead of global fetch() for HTTP requests. Import axios and use axios.get(), axios.post(), etc.',
    },
    schema: [], // no options
  },

  create(context) {
    /**
     * Check if a node represents a fetch call
     */
    function isFetchCall(node) {
      // Direct fetch() call
      if (node.type === 'CallExpression' &&
          node.callee.type === 'Identifier' &&
          node.callee.name === 'fetch') {
        return 'noFetch';
      }

      // window.fetch() or globalThis.fetch()
      if (node.type === 'CallExpression' &&
          node.callee.type === 'MemberExpression' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'fetch') {

        // Check if it's window.fetch or globalThis.fetch
        if (node.callee.object.type === 'Identifier' &&
            (node.callee.object.name === 'window' ||
             node.callee.object.name === 'globalThis')) {
          return 'noGlobalFetch';
        }
      }

      return null;
    }

    return {
      CallExpression(node) {
        const fetchType = isFetchCall(node);
        if (fetchType) {
          context.report({
            node: node.callee,
            messageId: fetchType,
          });
        }
      },
    };
  },
};