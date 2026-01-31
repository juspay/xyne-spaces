module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent importing defineQuery from @rocicorp/zero. Use @xyne/shared instead.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    messages: {
      noRocicorpDefineQuery: 'Do not import defineQuery from @rocicorp/zero. Use the ACL-aware version from @xyne/shared instead.',
    },
    schema: [],
  },

  create(context) {
    return {
      ImportDeclaration(node) {
        if (node.source.value === '@rocicorp/zero') {
          const hasDefineQuery = node.specifiers.some(
            specifier =>
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.name === 'defineQuery'
          );

          if (hasDefineQuery) {
            context.report({
              node,
              messageId: 'noRocicorpDefineQuery',
              fix(fixer) {
                const onlyDefineQuery = node.specifiers.length === 1 &&
                  node.specifiers[0].type === 'ImportSpecifier' &&
                  node.specifiers[0].imported.name === 'defineQuery';

                if (onlyDefineQuery) {
                  return fixer.replaceText(node.source, "'@xyne/shared'");
                } else {
                  const defineQuerySpecifier = node.specifiers.find(
                    specifier =>
                      specifier.type === 'ImportSpecifier' &&
                      specifier.imported.name === 'defineQuery'
                  );
                  
                  if (defineQuerySpecifier) {
                    const sourceCode = context.getSourceCode();
                    const text = sourceCode.getText(node);
                    
                    return [
                      fixer.remove(defineQuerySpecifier),
                      fixer.insertTextBefore(node, "import { defineQuery } from '@xyne/shared';\n")
                    ];
                  }
                }
              },
            });
          }
        }
      },
    };
  },
};
