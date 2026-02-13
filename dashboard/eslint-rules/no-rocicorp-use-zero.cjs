module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent importing useZero from @rocicorp/zero/react. Use the measured version from dashboard/src/hooks/useZero.ts instead.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: 'code',
    schema: [], 
    messages: {
      noRocicorpUseZero: 'Do not import useZero from @rocicorp/zero/react. Use the measured version from dashboard/src/hooks/useZero.ts instead.',
    },
  },

  create(context) {
    const filePath = context.getFilename();
    
    const isHookFile = filePath.endsWith('/src/hooks/useZero.ts');

    return {
      ImportDeclaration(node) {
        if (isHookFile) {
          return;
        }

        if (node.source.value === '@rocicorp/zero/react') {
          const useZeroSpecifier = node.specifiers.find(specifier => {
            if (specifier.type === 'ImportSpecifier') {
              return specifier.imported.name === 'useZero';
            }
            return false;
          });

          if (useZeroSpecifier) {
            context.report({
              node: useZeroSpecifier,
              messageId: 'noRocicorpUseZero',
              fix: fixer => {
                return fixer.replaceText(
                  node,
                  "import { useZero } from '../../hooks/useZero';"
                );
              },
            });
          }
        }
      },
    };
  },
};