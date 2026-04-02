/**
 * ESLint rule to enforce that conversations.insert includes initial_message_md
 * (and parent_message_md when parentMessageId is present).
 *
 * Denormalized _md fields must be populated at creation time so messages
 * render immediately without needing related joins.
 *
 * @example
 * // ❌ Invalid - missing initial_message_md
 * await tx.mutate.conversations.insert({
 *   conversationId, channelId, initialMessageId: messageId, ...
 * });
 *
 * // ✅ Valid
 * await tx.mutate.conversations.insert({
 *   conversationId, channelId, initialMessageId: messageId,
 *   initial_message_md: buildInitialMessageMd({ ... }),
 *   ...
 * });
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require initial_message_md (and parent_message_md when parentMessageId is set) in conversations.insert calls',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    messages: {
      missingInitialMessageMd:
        'conversations.insert must include "initial_message_md". Use buildInitialMessageMd() to populate it.',
      missingParentMessageMd:
        'conversations.insert with "parentMessageId" must also include "parent_message_md". Use buildParentMessageMd() to populate it.',
    },
    schema: [],
  },

  create(context) {
    return {
      CallExpression(node) {
        // Match: tx.mutate.conversations.insert(...)  or  *.mutate.conversations.insert(...)
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') {
          return;
        }

        // Check method name is 'insert'
        if (
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'insert'
        ) {
          return;
        }

        // Check the chain: *.conversations.insert
        const obj = callee.object;
        if (
          obj.type !== 'MemberExpression' ||
          obj.property.type !== 'Identifier' ||
          obj.property.name !== 'conversations'
        ) {
          return;
        }

        // Check the chain ends with: *.mutate.conversations.insert
        const mutateObj = obj.object;
        if (
          mutateObj.type !== 'MemberExpression' ||
          mutateObj.property.type !== 'Identifier' ||
          mutateObj.property.name !== 'mutate'
        ) {
          return;
        }

        // We have a *.mutate.conversations.insert(...) call.
        // Check the first argument is an object expression.
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'ObjectExpression') {
          return;
        }

        const propertyNames = new Set();
        for (const prop of arg.properties) {
          if (prop.type === 'Property' && prop.key.type === 'Identifier') {
            propertyNames.add(prop.key.name);
          }
          // SpreadElement properties are ignored (we can't statically check them)
        }

        // Must have initial_message_md
        if (!propertyNames.has('initial_message_md')) {
          context.report({ node, messageId: 'missingInitialMessageMd' });
        }

        // If parentMessageId is present, must have parent_message_md
        if (
          propertyNames.has('parentMessageId') &&
          !propertyNames.has('parent_message_md')
        ) {
          context.report({ node, messageId: 'missingParentMessageMd' });
        }
      },
    };
  },
};
