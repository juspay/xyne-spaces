module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/index.ts',
    '!src/database/migrations/**',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/src/test/setup.ts'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    // Source files use Node-ESM-style ".js" specifiers for TS siblings;
    // map them to the extensionless path so jest resolves the .ts file.
    '^(\\.{1,2}/.*)\\.js$': '$1',
    // @xyne/shared ships ESM that jest's CJS runtime cannot require.
    // Map the subpath this app consumes to its TS source so ts-jest
    // transforms it alongside test code.
    '^@xyne/shared/server/encryption-key-ring$':
      '<rootDir>/../../packages/shared/src/server/encryption-key-ring.ts',
    // @xyne/shared ships ESM in dist/, which jest cannot parse. Point at the TS
    // source so ts-jest transforms it.
    '^@xyne/shared/(.*)$': '<rootDir>/../../packages/shared/src/$1',
    '^@xyne/cache$': '<rootDir>/../../packages/cache/src/index.ts',
  },
};
