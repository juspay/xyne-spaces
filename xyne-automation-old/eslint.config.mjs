import js from '@eslint/js';
import simpleImportSort from 'eslint-plugin-simple-import-sort';
import globals from 'globals';
import tseslint from 'typescript-eslint';

import { defineConfig } from 'eslint/config';

export default defineConfig([
  {
    ignores: ['report/', 'dist/', 'node_modules/'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: {
      'simple-import-sort': simpleImportSort,
    },
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
    rules: {
      'no-console': 'error',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            [
              '^node:',
              '^(fs|path|os|url|util|events|stream|http|https|crypto|child_process|cluster|dgram|dns|net|readline|repl|tls|tty|v8|vm|zlib)(/.*|$)',
            ],
            ['^@?\\w'],
            ['^@?config', '^.*config.*$'],
            ['^@?lib', '^.*/lib/.*$'],
            ['^@?fixtures', '^.*/fixtures/.*$'],
            ['^\\.\\.(?!/?$)', '^\\.\\./?$', '^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../*', './*'],
              message:
                'Relative imports are not allowed. Use @ path aliases instead (e.g., @/lib/*, @/fixtures/*, @/config).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['lib/logger.ts'],
    rules: {
      'no-console': 'off',
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unused-expressions': 'off',
    },
  },
]);
