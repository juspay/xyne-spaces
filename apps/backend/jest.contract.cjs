// Dedicated runner for DB-backed *.contract.ts tests.
//
// Why a separate config instead of the default `npm test` (jest.config.cjs)?
//   1. These tests import real services (e.g. invitationService), whose module graph
//      pulls @xyne/shared, which ships ESM in `dist`. The CJS jest runtime cannot
//      evaluate that graph, so @xyne/shared is stubbed here (the accept path only uses
//      TYPES from it, which are erased at runtime).
//   2. Full-program ts-jest type-checking of the whole backend OOMs the worker; these
//      tests only need transpilation, so `isolatedModules` is enabled.
//   3. They need real DB env loaded before config/env.ts validates it.
//
// The default `npm test` glob (*.test.ts / *.spec.ts) intentionally does NOT match
// *.contract.ts, so this file leaves the default suite's behavior unchanged.
//
// Run:  npx jest --config jest.contract.cjs
const base = require('./jest.config.cjs');

module.exports = {
  ...base,
  testMatch: ['**/?(*.)+(contract).ts'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { isolatedModules: true }],
  },
  setupFiles: ['<rootDir>/src/test/loadTestEnv.cjs'],
  moduleNameMapper: {
    ...(base.moduleNameMapper || {}),
    '^@xyne/shared$': '<rootDir>/src/test/__mocks__/xyneSharedStub.cjs',
    '^@xyne/shared/.*$': '<rootDir>/src/test/__mocks__/xyneSharedStub.cjs',
  },
};
