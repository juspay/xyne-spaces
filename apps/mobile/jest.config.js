/**
 * Component rendering tests — jest-expo + React Native Testing Library.
 *
 * jest is scoped to `*.test.tsx` on purpose. Logic tests (`*.test.ts`)
 * are run by node:test (see `test:logic`), so keeping jest on tsx files
 * means the two runners never collide over the same file.
 *
 * All test files live under `tests/unit/`. The extension boundary
 * (`.test.ts` vs `.test.tsx`) determines which runner picks them up.
 *
 * @type {import('jest').Config}
 */
module.exports = {
  preset: 'jest-expo',
  testMatch: ['<rootDir>/tests/unit/**/*.test.tsx'],
  setupFilesAfterEnv: ['<rootDir>/tests/jest.setup.ts'],
  moduleNameMapper: {
    // Mirror the `@/*` -> `./*` alias from tsconfig.json.
    '^@/(.*)$': '<rootDir>/$1',
    // uuid v13 ships ESM-only; jest cannot parse it from node_modules.
    '^uuid$': '<rootDir>/tests/mocks/uuid.ts',
  },
  clearMocks: true,
};
