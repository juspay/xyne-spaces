module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: [
    '@typescript-eslint',
    'local-rules',
  ],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'prettier',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/no-non-null-assertion': 'off',
    '@typescript-eslint/no-namespace': 'off',
    '@typescript-eslint/ban-types': 'off',
    'prefer-const': 'error',
    'no-var': 'error',
    'no-case-declarations': 'off',
    'no-console': 'error',
    'no-restricted-imports': ['error', {
      paths: [
        {
          name: '@/services/gcsService',
          message: 'Use getStorageService() from @/services/storage instead of direct GCS access.',
        },
        {
          name: '../services/gcsService',
          message: 'Use getStorageService() from @/services/storage instead of direct GCS access.',
        },
        {
          name: './gcsService',
          message: 'Use getStorageService() from @/services/storage instead of direct GCS access.',
        },
        {
          name: '@/services/gcsServiceFactory',
          message: 'Use getStorageService() from @/services/storage instead of GCSServiceFactory.',
        },
        {
          name: '../services/gcsServiceFactory',
          message: 'Use getStorageService() from @/services/storage instead of GCSServiceFactory.',
        },
        {
          name: './gcsServiceFactory',
          message: 'Use getStorageService() from @/services/storage instead of GCSServiceFactory.',
        },
      ],
      patterns: [
        {
          group: ['**/gcsService', '**/gcsService.js'],
          message: 'Use getStorageService() from @/services/storage instead of direct GCS access.',
        },
        {
          group: ['**/gcsServiceFactory', '**/gcsServiceFactory.js'],
          message: 'Use getStorageService() from @/services/storage instead of GCSServiceFactory.',
        },
      ],
    }],
    'local-rules/no-duplicate-workflow-steps': 'error',
    'local-rules/no-rocicorp-define-query': 'error',
    'local-rules/require-is-deleted-filter': 'error',
  },
  env: {
    node: true,
    es6: true,
    jest: true,
  },
  overrides: [
    {
      // These files are the storage abstraction internals — they need direct GCS access
      files: [
        'src/services/gcsService.ts',
        'src/services/gcsServiceFactory.ts',
        'src/services/storage/gcsAdapter.ts',
        'src/services/storage/storageServiceFactory.ts',
        // GCS-specific: bundleController uses its own Storage client for static file serving
        'src/controllers/bundleController.ts',
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
  ],
  ignorePatterns: ['**/*.test.ts', '**/*.spec.ts', 'dist/**', 'node_modules/**'],
};
