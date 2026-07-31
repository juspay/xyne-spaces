/**
 * ESLint rule to enforce using isDeleted filter when querying soft-deletable tables
 *
 * This rule ensures that soft-deleted records are not accidentally included in queries.
 * All queries on the following tables must include a where('isDeleted', false) filter:
 * - channel_user_status
 * - bookmarks
 *
 * For channel_user_status, the participantsStatus relation is also checked.
 *
 * Exceptions:
 * - .limit(0) queries (intentional empty results)
 * - getAllChannelsUserStatus query (intentionally returns all statuses including soft-deleted)
 *
 * @example
 * // ❌ Invalid - missing isDeleted filter
 * zql.channel_user_status.where('userId', ctx.userID)
 * zql.bookmarks.where('userId', ctx.userID)
 * zql.channels.whereExists('participantsStatus', p => p.where('userId', ctx.userID))
 *
 * // ✅ Valid - includes isDeleted filter
 * zql.channel_user_status.where('userId', ctx.userID).where('isDeleted', false)
 * zql.bookmarks.where('userId', ctx.userID).where('isDeleted', false)
 * zql.channels.whereExists('participantsStatus', p => p.where('userId', ctx.userID).where('isDeleted', false))
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require isDeleted filter when querying soft-deletable tables (channel_user_status, bookmarks)',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    messages: {
      missingIsDeletedFilter: 'Queries on {{tableName}} must include .where("isDeleted", false) filter to exclude soft-deleted records.',
      missingIsDeletedFilterRelation: 'Queries using {{relationName}} relation must include .where("isDeleted", false) filter to exclude soft-deleted records.',
    },
    schema: [],
  },

  create(context) {
    const filename = context.getFilename();

    const isRelevantFile = filename.includes('/zero/queries') ||
                           filename.includes('/zero/mutator') ||
                           filename.endsWith('/queries.ts') ||
                           filename.endsWith('/mutators.ts');

    if (!isRelevantFile) {
      return {};
    }

    const reportedNodes = new Set();

    const sourceCode = context.getSourceCode();

    // Tables that require isDeleted filter
    const SOFT_DELETABLE_TABLES = ['channel_user_status', 'bookmarks'];
    
    // Relations that require isDeleted filter
    const SOFT_DELETABLE_RELATIONS = ['participantsStatus'];

    function getQueryRoot(node) {
      let current = node;
      let depth = 0;
      const maxDepth = 50;

      while (current && depth < maxDepth) {
        depth++;

        if (current.type === 'CallExpression') {
          if (current.callee.type === 'MemberExpression') {
            const obj = current.callee.object;
            if (obj.type === 'Identifier' && obj.name === 'zql') {
              const prop = current.callee.property;
              if (prop.type === 'Identifier') {
                return { type: 'zql_table', tableName: prop.name, node: current };
              }
            }
            current = obj;
          } else {
            break;
          }
        } else if (current.type === 'MemberExpression') {
          if (current.object.type === 'Identifier' && current.object.name === 'zql') {
            const prop = current.property;
            if (prop.type === 'Identifier') {
              return { type: 'zql_table', tableName: prop.name, node: current };
            }
          }
          current = current.object;
        } else if (current.type === 'Identifier') {
          if (current.name === 'zql') {
            return { type: 'zql_root', node: current };
          }
          break;
        } else {
          break;
        }
      }

      return null;
    }

    function extractTableFromCall(node) {
      if (node.type !== 'CallExpression') return null;
      if (node.callee.type !== 'MemberExpression') return null;
      if (node.callee.property.type !== 'Identifier') return null;

      const methodName = node.callee.property.name;
      const args = node.arguments;

      if (methodName === 'whereExists' || methodName === 'exists') {
        if (args.length >= 1 && args[0].type === 'Literal' && SOFT_DELETABLE_RELATIONS.includes(args[0].value)) {
          if (args.length >= 2) {
            return { type: 'relation_with_callback', relationName: args[0].value, node, callback: args[1] };
          }
          return { type: 'relation', relationName: args[0].value, node };
        }
      }

      if (methodName === 'related') {
        if (args.length >= 1 && args[0].type === 'Literal' && SOFT_DELETABLE_RELATIONS.includes(args[0].value)) {
          if (args.length >= 2) {
            return { type: 'relation_with_callback', relationName: args[0].value, node, callback: args[1] };
          }
          return { type: 'relation', relationName: args[0].value, node };
        }
      }

      return null;
    }

    function hasIsDeletedInChain(node, depth = 0) {
      if (depth > 100 || !node) return false;

      if (node.type === 'CallExpression') {
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'where') {
          const args = node.arguments;
          if (args.length >= 2) {
            const firstArg = args[0];
            if (firstArg.type === 'Literal' && firstArg.value === 'isDeleted') {
              return true;
            }
          }
        }

        if (hasIsDeletedInChain(node.callee, depth + 1)) return true;

        for (const arg of node.arguments) {
          if (hasIsDeletedInChain(arg, depth + 1)) return true;
        }
      }

      if (node.type === 'MemberExpression') {
        if (hasIsDeletedInChain(node.object, depth + 1)) return true;
      }

      if (node.type === 'ArrowFunctionExpression' || node.type === 'FunctionExpression') {
        if (hasIsDeletedInChain(node.body, depth + 1)) return true;
      }

      if (node.type === 'BlockStatement') {
        for (const stmt of node.body) {
          if (hasIsDeletedInChain(stmt, depth + 1)) return true;
        }
      }

      if (node.type === 'ReturnStatement' && node.argument) {
        if (hasIsDeletedInChain(node.argument, depth + 1)) return true;
      }

      return false;
    }

    function hasLimitZero(node, depth = 0) {
      if (depth > 50 || !node) return false;

      if (node.type === 'CallExpression') {
        if (node.callee.type === 'MemberExpression' &&
            node.callee.property.type === 'Identifier' &&
            node.callee.property.name === 'limit') {
          const args = node.arguments;
          if (args.length >= 1 && args[0].type === 'Literal' && args[0].value === 0) {
            return true;
          }
        }
        return hasLimitZero(node.callee, depth + 1);
      }

      if (node.type === 'MemberExpression') {
        return hasLimitZero(node.object, depth + 1);
      }

      return false;
    }

    function isTerminalMethod(methodName) {
      return ['one', 'run', 'limit', 'orderBy', 'related', 'first'].includes(methodName);
    }

    function checkQuery(node, isTerminal = false) {
      if (node.type !== 'CallExpression') return;
      if (node.callee.type !== 'MemberExpression') return;
      if (node.callee.property.type !== 'Identifier') return;

      const methodName = node.callee.property.name;

      const rootInfo = getQueryRoot(node);
      const isSoftDeletableTable = rootInfo?.type === 'zql_table' && SOFT_DELETABLE_TABLES.includes(rootInfo.tableName);

      const relationInfo = extractTableFromCall(node);

      if (!isSoftDeletableTable && !relationInfo) return;

      if (hasLimitZero(node)) return;

      if (isSoftDeletableTable && hasIsDeletedInChain(node)) return;

      if (relationInfo) {
        if (relationInfo.type === 'relation_with_callback') {
          if (hasIsDeletedInChain(relationInfo.callback)) return;
        }
      }

      if (!isTerminal && !isTerminalMethod(methodName) && methodName !== 'where') {
        return;
      }

      if (methodName === 'where') {
        const parent = node.parent;
        if (parent?.type === 'MemberExpression' && parent.parent?.type === 'CallExpression') {
          const grandparentMethod = parent.parent.callee?.property?.name;
          if (['where', ...['one', 'run', 'limit', 'orderBy', 'related', 'first']].includes(grandparentMethod)) {
            return;
          }
        }
      }

      if (reportedNodes.has(node)) return;

      reportedNodes.add(node);

      const isRelationError = relationInfo !== null;
      const tableName = isRelationError ? null : rootInfo?.tableName;
      const relationName = isRelationError ? relationInfo.relationName : null;
      
      context.report({
        node,
        messageId: isRelationError ? 'missingIsDeletedFilterRelation' : 'missingIsDeletedFilter',
        data: {
          tableName: tableName || '',
          relationName: relationName || '',
        },
      });
    }

    return {
      ReturnStatement(node) {
        if (node.argument) {
          checkQuery(node.argument, true);
        }
      },

      'CallExpression:exit'(node) {
        checkQuery(node, false);
      },
    };
  },
};
