/**
 * ESLint rule to prevent usage of Date.now() and uuid functions in mutator files
 *
 * This rule ensures that timestamps and UUIDs are passed as parameters to mutators
 * rather than being generated within the mutator itself. This is important for:
 * - Consistency across frontend and backend
 * - Deterministic behavior
 * - Proper testability
 * - Replication correctness in Zero
 *
 * @example
 * // ❌ Invalid - using Date.now() in mutator
 * const timestamp = Date.now();
 *
 * // ❌ Invalid - using uuid in mutator
 * const id = uuidv4();
 * const id = uuid.v4();
 *
 * // ✅ Valid - passing as parameters
 * async ({ tx, args: { timestamp, messageId } }) => {
 *   // use the passed timestamp and messageId
 * }
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent usage of Date.now() and uuid functions in mutator files',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null, // This rule doesn't provide auto-fixes
    messages: {
      noDateNow: 'Do not use Date.now() in mutators. Pass timestamp as a parameter instead.',
      noUuidCall: 'Do not use {{functionName}} in mutators. Pass UUID as a parameter instead.',
    },
    schema: [], // no options
  },

  create(context) {
    // Check if the file is a mutator file
    const filename = context.getFilename();
    const isMutatorFile = filename.includes('/zero/mutator') || filename.endsWith('/mutators.ts') || filename.endsWith('/mutators.js');

    if (!isMutatorFile) {
      return {}; // Rule doesn't apply to non-mutator files
    }

    // Track uuid imports
    let importedUuidFunctions = new Set();

    return {
      // Track import statements for uuid
      ImportDeclaration(node) {
        if (node.source.value === 'uuid' || node.source.value === '@types/uuid') {
          node.specifiers.forEach(specifier => {
            if (specifier.type === 'ImportDefaultSpecifier') {
              importedUuidFunctions.add(specifier.local.name);
            } else if (specifier.type === 'ImportSpecifier') {
              // Track the local name (what the function is called in the file)
              // This catches patterns like: import {v4} from 'uuid'; import {v4 as uuidv4} from 'uuid';
              importedUuidFunctions.add(specifier.local.name);
            } else if (specifier.type === 'ImportNamespaceSpecifier') {
              importedUuidFunctions.add(specifier.local.name);
            }
          });
        }
      },

      // Check for Date.now() calls and uuid function calls
      CallExpression(node) {
        // Check for Date.now()
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          node.callee.object.name === 'Date' &&
          node.callee.property.type === 'Identifier' &&
          node.callee.property.name === 'now' &&
          node.arguments.length === 0
        ) {
          context.report({
            node,
            messageId: 'noDateNow',
          });
        }

        // Check for uuid function calls (e.g., v4(), uuidv4(), uuid.v4())
        if (node.callee.type === 'Identifier') {
          const functionName = node.callee.name;

          // Check if this is a function imported from uuid module
          // This catches patterns like: import {v4} from 'uuid'; v4();
          if (importedUuidFunctions.has(functionName)) {
            context.report({
              node,
              messageId: 'noUuidCall',
              data: { functionName },
            });
          }

          // Also check for common uuid function names (for backwards compatibility)
          const uuidFunctionPatterns = [
            'uuidv4',
            'uuidv1',
            'uuidv3',
            'uuidv5',
            'uuidv6',
            'uuidv7',
            'uuid',
          ];

          if (uuidFunctionPatterns.some(pattern => functionName === pattern)) {
            context.report({
              node,
              messageId: 'noUuidCall',
              data: { functionName },
            });
          }
        }

        // Check for uuid.v4() style calls
        if (
          node.callee.type === 'MemberExpression' &&
          node.callee.object.type === 'Identifier' &&
          importedUuidFunctions.has(node.callee.object.name) &&
          node.callee.property.type === 'Identifier'
        ) {
          const methodName = node.callee.property.name;
          if (methodName.startsWith('v') || methodName === 'NIL' || methodName === 'validate') {
            context.report({
              node,
              messageId: 'noUuidCall',
              data: { functionName: `${node.callee.object.name}.${methodName}` },
            });
          }
        }
      },

      // Reset imports when leaving a file
      'Program:exit'() {
        importedUuidFunctions.clear();
      },
    };
  },
};