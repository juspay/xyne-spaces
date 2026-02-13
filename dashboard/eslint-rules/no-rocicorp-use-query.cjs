module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Prevent importing useQuery from @rocicorp/zero/react. Use the measured version from dashboard/src/hooks/useQuery.ts instead.',
      category: 'Best Practices',
      recommended: true,
    },
    fixable: null,
    messages: {
      noRocicorpUseQuery: 'Do not import useQuery from @rocicorp/zero/react. Replace it with: import { useQuery } from "../../hooks/useQuery";',
    },
    schema: [],
  },

  create(context) {
    const filePath = context.getFilename();
    
    const isHookFile = filePath.endsWith('/src/hooks/useQuery.ts');

    return {
      ImportDeclaration(node) {
        if (node.source.value === '@rocicorp/zero/react') {
          const hasUseQuery = node.specifiers.some(
            specifier =>
              specifier.type === 'ImportSpecifier' &&
              specifier.imported.name === 'useQuery'
          );

          if (hasUseQuery && !isHookFile) {
            context.report({
              node,
              messageId: 'noRocicorpUseQuery',
            });
          }
        }
      },
    };
  },
};