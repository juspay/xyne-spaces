const SSRF_FETCH_MESSAGE =
  'Raw fetch is not SSRF-safe: use safeWebhookFetch() or safeFetchFollowingRedirects() from @/utils/ssrfGuard for any URL a user, app or stored config can influence.';
const SSRF_HTTP_CLIENT_MESSAGE =
  'HTTP client libraries bypass the SSRF guard: use safeWebhookFetch() or safeFetchFollowingRedirects() from @/utils/ssrfGuard for any URL a user, app or stored config can influence.';

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
    // SSRF: an outbound request to a URL a user, app or stored config can influence goes
    // through utils/ssrfGuard.ts (safeWebhookFetch / safeFetchFollowingRedirects).
    'no-restricted-globals': ['error', { name: 'fetch', message: SSRF_FETCH_MESSAGE }],
    'no-restricted-properties': ['error', { object: 'globalThis', property: 'fetch', message: SSRF_FETCH_MESSAGE }],
    '@typescript-eslint/no-restricted-imports': ['error', {
      paths: [
        { name: 'axios', message: SSRF_HTTP_CLIENT_MESSAGE },
        { name: 'node-fetch', message: SSRF_HTTP_CLIENT_MESSAGE },
        { name: 'cross-fetch', message: SSRF_HTTP_CLIENT_MESSAGE },
        { name: 'got', message: SSRF_HTTP_CLIENT_MESSAGE },
        { name: 'undici', importNames: ['fetch', 'request', 'stream'], message: SSRF_HTTP_CLIENT_MESSAGE },
      ],
    }],
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
    {
      // The guard itself is the one place allowed to use the HTTP client directly.
      files: ['src/utils/ssrfGuard.ts'],
      rules: {
        'no-restricted-globals': 'off',
        'no-restricted-properties': 'off',
        '@typescript-eslint/no-restricted-imports': 'off',
      },
    },
  ],
  ignorePatterns: ['**/*.test.ts', '**/*.spec.ts', 'dist/**', 'node_modules/**'],
};
