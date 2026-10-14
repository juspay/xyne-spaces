import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import reactPlugin from 'eslint-plugin-react';
import reactHooksPlugin from 'eslint-plugin-react-hooks';
import jsxA11yPlugin from 'eslint-plugin-jsx-a11y';
import eslintConfigPrettier from 'eslint-config-prettier';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const localRules = {
  rules: {
    'no-fetch-use-axios': require('./eslint-rules/no-fetch-use-axios.cjs'),
    'no-rocicorp-define-query': require('../../packages/shared/eslint-rules/no-rocicorp-define-query.cjs'),
    'no-rocicorp-use-query': require('./eslint-rules/no-rocicorp-use-query.cjs'),
    'no-rocicorp-use-zero': require('./eslint-rules/no-rocicorp-use-zero.cjs'),
    'no-date-now-or-uuid-in-mutators': require('./eslint-rules/no-date-now-or-uuid-in-mutators.cjs'),
    'require-is-deleted-filter': require('../../packages/shared/eslint-rules/require-is-deleted-filter.cjs'),
  },
};

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      'node_modules/',
      'dist/',
      'coverage/',
      'build/',
      '.expo/',
      '*.config.js',
      '*.config.ts',
      // "*.cjs",
      'public/**/*',
      'eslint-rules/**/*',
    ],
  },
  // {
  //   files: ['**/*.cjs'],
  //   languageOptions: {
  //     globals: {
  //       ...globals.node,
  //     },
  //   },
  //   rules: {
  //     '@typescript-eslint/no-require-imports': 'off',
  //   },
  // },

  // Base JavaScript recommended rules
  js.configs.recommended,

  // TypeScript recommended rules (without type checking)
  ...tseslint.configs.recommended,

  // React configuration
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooksPlugin,
      'jsx-a11y': jsxA11yPlugin,
      'local-rules': localRules,
    },
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2020,
        ...globals.reactNative,
      },
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      ...reactPlugin.configs.recommended.rules,
      ...reactHooksPlugin.configs.recommended.rules,
      ...jsxA11yPlugin.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'local-rules/no-fetch-use-axios': 'error',
      'local-rules/no-rocicorp-define-query': 'error',
      'local-rules/no-rocicorp-use-query': 'error',
      'local-rules/no-rocicorp-use-zero': 'error',
      'local-rules/no-date-now-or-uuid-in-mutators': 'error',
      'local-rules/require-is-deleted-filter': 'error',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'expo-haptics',
              message:
                'Import { haptics } from "@/src/utils/haptics" instead. Calling expo-haptics directly skips the Android (performAndroidHapticsAsync) branch, so the feedback silently degrades on Android.',
            },
            {
              name: '@legendapp/state/react',
              importNames: ['use$'],
              message:
                'Use { useValue } instead — same function, but React only recognises a hook by its name ("use" + an uppercase letter). React Compiler, which this app enables, compiles use$() to a one-time call cached behind a memo sentinel: it reads once on first render and never updates again. Fast refresh hides this, so it only shows up in release builds.',
            },
          ],
        },
      ],
    },
  },

  // TypeScript specific configuration for src/app files with type checking
  {
    files: ['src/**/*.ts', 'src/**/*.tsx', 'app/**/*.ts', 'app/**/*.tsx'],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Type-checked rules
      ...tseslint.configs.recommendedTypeChecked.rules,

      // Enforce explicit return types on functions and class methods
      '@typescript-eslint/explicit-function-return-type': 'warn',
      // Disallow the use of 'any' type
      '@typescript-eslint/no-explicit-any': 'error',
      // Warn about unused variables, allowing those prefixed with _
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Disallow unused expressions
      '@typescript-eslint/no-unused-expressions': 'error',
      // Prefer const over let for variables that are never reassigned
      'prefer-const': 'error',

      // Naming Convention Rules
      '@typescript-eslint/naming-convention': [
        'warn',
        {
          selector: 'default',
          format: ['PascalCase', 'camelCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
          trailingUnderscore: 'forbid',
        },
        {
          selector: 'variable',
          format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'function',
          format: ['camelCase', 'PascalCase'],
        },
        {
          selector: 'parameter',
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'property',
          format: ['PascalCase', 'camelCase', 'UPPER_CASE'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'typeLike',
          format: ['PascalCase'],
          leadingUnderscore: 'allow',
        },
        {
          selector: 'enumMember',
          format: ['UPPER_CASE'],
        },
        {
          selector: 'typeParameter',
          format: ['PascalCase'],
        },
        {
          selector: 'memberLike',
          modifiers: ['private', 'protected'],
          format: ['camelCase'],
          leadingUnderscore: 'allow',
        },
      ],
    },
  },

  // General rules for all JS/TS files
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      // Same `_` convention everywhere (the src/app block above does not reach tests/ or plugins/).
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Enforce strict equality (=== and !==)
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      // Disallow the use of console.log in production
      'no-console': 'warn',
      // Enforce curly braces for all control statements
      curly: ['error', 'all'],
      // Prefer early returns over else blocks when possible
      'no-else-return': 'warn',
    },
  },

  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    rules: {
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-console': 'warn',
      curly: ['error', 'all'],
      'no-else-return': 'warn',
    },
  },

  // Tab shell routes. The redesign adds a second route group alongside
  // `(tabs)`, so a literal path here would send half the users into the wrong
  // shell and a `segments.includes('(tabs)')` check would silently go false.
  // Everything goes through src/navigation/routes.ts instead.
  {
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    ignores: [
      // Owns the constant.
      'src/navigation/routes.ts',
      // Declares the route tree itself — these name directories, not destinations.
      'app/(protected)/_layout.tsx',
      'app/(protected)/(tabs)/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/\\(tabs\\)/]',
          message:
            "Do not hardcode '(tabs)'. Use tabRoute/tabPath/isOnTabShell from '@/src/navigation/routes' so the redesign's second route group resolves correctly.",
        },
        {
          selector: 'TemplateElement[value.raw=/\\(tabs\\)/]',
          message:
            "Do not hardcode '(tabs)'. Use tabRoute/tabPath/isOnTabShell from '@/src/navigation/routes' so the redesign's second route group resolves correctly.",
        },
      ],
    },
  },

  // Tab shell routes. The redesign adds a second route group alongside
  // `(tabs)`, so a literal path here would send half the users into the wrong
  // shell and a `segments.includes('(tabs)')` check would silently go false.
  // Everything goes through src/navigation/routes.ts instead.
  {
    files: ['src/**/*.{ts,tsx}', 'app/**/*.{ts,tsx}'],
    ignores: [
      // Owns the constant.
      'src/navigation/routes.ts',
      // Declares the route tree itself — these name directories, not destinations.
      'app/(protected)/_layout.tsx',
      'app/(protected)/(tabs)/**',
    ],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/\\(tabs\\)/]',
          message:
            "Do not hardcode '(tabs)'. Use tabRoute/tabPath/isOnTabShell from '@/src/navigation/routes' so the redesign's second route group resolves correctly.",
        },
        {
          selector: 'TemplateElement[value.raw=/\\(tabs\\)/]',
          message:
            "Do not hardcode '(tabs)'. Use tabRoute/tabPath/isOnTabShell from '@/src/navigation/routes' so the redesign's second route group resolves correctly.",
        },
      ],
    },
  },

  // Flag keys are namespaced data ('ui.shell'), not identifiers. The naming
  // convention does not apply to them.
  {
    files: ['src/flags/registry.ts'],
    rules: {
      '@typescript-eslint/naming-convention': 'off',
    },
  },

  // App entry file: runs in Hermes where `global` is the global object.
  {
    files: ['index.js'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // CommonJS config files - must come AFTER tseslint to override no-require-imports
  {
    files: ['**/*.cjs'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off',
    },
  },

  // Logic tests (tests/unit/**/*.test.ts) must stay pure — no rendering imports.
  // Component / render tests belong to *.test.tsx files (run by jest).
  {
    files: ['tests/unit/**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      // Test callbacks do not need explicit return types.
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Enforce the logic/render boundary: no React / React Native / rendering libraries.
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'Logic tests must not import React. Put rendering tests in *.test.tsx.',
            },
            {
              name: 'react-dom',
              message: 'Logic tests must not import react-dom. Put rendering tests in *.test.tsx.',
            },
            {
              name: 'react-native',
              message:
                'Logic tests must not import react-native. Put rendering tests in *.test.tsx.',
            },
            {
              name: 'react-test-renderer',
              message:
                'Logic tests must not import react-test-renderer. Put rendering tests in *.test.tsx.',
            },
          ],
          patterns: [
            {
              group: [
                'react-native/*',
                '@react-native/*',
                '@testing-library/*',
                'expo-router/testing-library',
                'react-dom/*',
              ],
              message:
                'Logic tests must stay free of rendering libraries. Use *.test.tsx for component/render tests.',
            },
          ],
        },
      ],
    },
  },

  // Component render tests (tests/unit/**/*.test.tsx) — jest-expo + React
  // Native Testing Library. Unlike logic tests above, these MAY import
  // React / React Native / @testing-library to render and assert on components.
  {
    files: ['tests/unit/**/*.test.tsx'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
    rules: {
      // Test callbacks do not need explicit return types.
      '@typescript-eslint/explicit-function-return-type': 'off',
      // jest.mock() factories are hoisted above imports, so they must load
      // modules lazily with require(); mock components need no display names.
      '@typescript-eslint/no-require-imports': 'off',
      'react/display-name': 'off',
    },
  },

  // TEMPORARY — chat v3 only. Remove this whole block in Phase 11 when v2 is
  // deleted. ESLint must not keep feature-specific overrides in the shared
  // config; these rules were a rewrite guardrail, not a new lint architecture.
  // Chat v3 — file budget + LegendList extraData ban (design C1, C15).
  {
    files: ['src/features/chat/v3/**/*.{ts,tsx}'],
    rules: {
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'no-restricted-syntax': [
        'error',
        {
          selector: 'JSXAttribute[name.name="extraData"]',
          message:
            'C15: extraData is banned on LegendList — it re-renders every row. Put the value in the row model instead.',
        },
      ],
    },
  },

  // TEMPORARY — chat v3 only. Remove in Phase 11 (see block above).
  // Chat v3 pure layers — no React / React Native (design C16).
  {
    files: [
      'src/features/chat/v3/intent/**/*.{ts,tsx}',
      'src/features/chat/v3/machine/**/*.{ts,tsx}',
      'src/features/chat/v3/model/**/*.{ts,tsx}',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'expo-haptics',
              message:
                'Import { haptics } from "@/src/utils/haptics" instead. Calling expo-haptics directly skips the Android (performAndroidHapticsAsync) branch, so the feedback silently degrades on Android.',
            },
            {
              name: 'react',
              message: 'Chat v3 pure layers (intent/machine/model) must not import React.',
            },
            {
              name: 'react-native',
              message: 'Chat v3 pure layers (intent/machine/model) must not import react-native.',
            },
          ],
          patterns: [
            {
              // `react-native/*` does not match the package root. List both
              // (code-review F4) so `from 'react-native'` cannot slip through.
              group: ['react', 'react/*', 'react-native', 'react-native/*', '@react-native/*'],
              message:
                'Chat v3 pure layers (intent/machine/model) must not import React or react-native.',
            },
          ],
        },
      ],
    },
  },

  // TEMPORARY — chat v3 only. Remove in Phase 11 (see block above).
  // Chat v3 logic tests — same renderer ban as tests/unit/**/*.test.ts.
  {
    files: ['src/features/chat/v3/__tests__/**/*.test.ts'],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      '@typescript-eslint/explicit-function-return-type': 'off',
      // Ported policy suites exceed the production file budget on purpose.
      'max-lines': 'off',
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: 'react',
              message: 'Logic tests must not import React. Put rendering tests in *.test.tsx.',
            },
            {
              name: 'react-dom',
              message: 'Logic tests must not import react-dom. Put rendering tests in *.test.tsx.',
            },
            {
              name: 'react-native',
              message:
                'Logic tests must not import react-native. Put rendering tests in *.test.tsx.',
            },
            {
              name: 'react-test-renderer',
              message:
                'Logic tests must not import react-test-renderer. Put rendering tests in *.test.tsx.',
            },
          ],
          patterns: [
            {
              group: [
                'react-native/*',
                '@react-native/*',
                '@testing-library/*',
                'expo-router/testing-library',
                'react-dom/*',
              ],
              message:
                'Logic tests must stay free of rendering libraries. Use *.test.tsx for component/render tests.',
            },
          ],
        },
      ],
    },
  },

  // Prettier configuration - MUST BE LAST
  eslintConfigPrettier,
);
