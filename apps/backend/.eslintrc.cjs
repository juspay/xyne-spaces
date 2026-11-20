// Direct GCS access goes through the storage abstraction.
const GCS_IMPORT_PATHS = [
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
];
const GCS_IMPORT_PATTERNS = [
  {
    group: ['**/gcsService', '**/gcsService.js'],
    message: 'Use getStorageService() from @/services/storage instead of direct GCS access.',
  },
  {
    group: ['**/gcsServiceFactory', '**/gcsServiceFactory.js'],
    message: 'Use getStorageService() from @/services/storage instead of GCSServiceFactory.',
  },
];

// reveal() reads an UnreadableString. Only the files allowed below may import it (see overrides):
// everywhere else an unreadable value is carried, written through tx.mutate, or decided on facts.
const REVEAL_MESSAGE =
  'reveal() reads an unreadable value. Decide on derived facts (tx.read / getMutationFacts) and write it through tx.mutate instead.';
const REVEAL_IMPORT_PATHS = [{ name: '@xyne/shared', importNames: ['reveal'], message: REVEAL_MESSAGE }];
const REVEAL_IMPORT_PATTERNS = [{ group: ['**/enc-contracts/unreadable-string', '**/enc-contracts/unreadable-string.js'], message: REVEAL_MESSAGE }];

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
      paths: [...GCS_IMPORT_PATHS, ...REVEAL_IMPORT_PATHS],
      patterns: [...GCS_IMPORT_PATTERNS, ...REVEAL_IMPORT_PATTERNS],
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
      ],
      rules: {
        'no-restricted-imports': 'off',
      },
    },
    {
      // The files allowed to reveal an UnreadableString: the Zero transaction wrapper, which
      // unwraps right before the database write, and the REST reply handler, which still reads
      // the text until its route has a write/read wrapper of its own.
      files: ['src/zero/unreadableTransaction.ts', 'src/controllers/conversationController.ts'],
      rules: {
        'no-restricted-imports': ['error', { paths: GCS_IMPORT_PATHS, patterns: GCS_IMPORT_PATTERNS }],
      },
    },
  ],
  ignorePatterns: ['**/*.test.ts', '**/*.spec.ts', 'dist/**', 'node_modules/**'],
};
