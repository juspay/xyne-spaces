/**
 * ESLint rule to prevent direct zql.messages.where('messageId', ...) lookups
 * in mutator files. Use resolveMessage() from messageMetadata instead.
 *
 * After denormalizing initial messages into initial_message_md on conversations,
 * message rows may not be in the client's local Zero store. Direct lookups will
 * return null for initial messages. resolveMessage() handles the fallback.
 *
 * @example
 * // ❌ Invalid
 * const message = await tx.run(zql.messages.where('messageId', id).one());
 *
 * // ✅ Valid
 * const message = await resolveMessage(tx, id);
 */

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow direct zql.messages.where("messageId", ...) in mutators. Use resolveMessage() instead.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    messages: {
      noDirectMessageLookup:
        'Do not use zql.messages.where(\'messageId\', ...) directly in mutators. Use resolveMessage(tx, messageId) from messageMetadata instead, which falls back to initial_message_md when the message is not in the local store.',
    },
    schema: [],
  },

  create(context) {
    // Only apply to mutator files
    const filename = context.getFilename();
    if (!filename.includes('mutators')) {
      return {};
    }

    return {
      CallExpression(node) {
        // Match: zql.messages.where('messageId', ...)
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') {
          return;
        }

        // Check method name is 'where'
        if (
          callee.property.type !== 'Identifier' ||
          callee.property.name !== 'where'
        ) {
          return;
        }

        // Check the first argument is 'messageId'
        const firstArg = node.arguments[0];
        if (
          !firstArg ||
          firstArg.type !== 'Literal' ||
          firstArg.value !== 'messageId'
        ) {
          return;
        }

        // Walk up the chain to find zql.messages
        let obj = callee.object;

        // Handle chained calls like zql.messages.where(...).where('messageId', ...)
        while (obj.type === 'CallExpression') {
          obj = obj.callee;
          if (obj.type === 'MemberExpression') {
            obj = obj.object;
          } else {
            return;
          }
        }

        // Check for zql.messages
        if (
          obj.type === 'MemberExpression' &&
          obj.property.type === 'Identifier' &&
          obj.property.name === 'messages' &&
          obj.object.type === 'Identifier' &&
          obj.object.name === 'zql'
        ) {
          context.report({ node, messageId: 'noDirectMessageLookup' });
        }
      },
    };
  },
};
