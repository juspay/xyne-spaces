# Mobile test setup — Logic tests

This document describes the **logic test layer** for the Xyne Spaces mobile app.
Logic tests are fast, pure-TypeScript unit tests that run under Node with no
emulator, no bundler, and no rendering.

## Test layers

| Layer | What it covers | Runner | Status |
|------|----------------|--------|--------|
| **Static** | typecheck + lint + format | `tsc`, `eslint`, `prettier` | already present (`pnpm run validate`) |
| **Unit — logic** | pure functions & reducers | `node:test` via `tsx` | **this doc** |
| **Unit — components** | component render + behaviour | jest-expo + RNTL | present — see [rendering-tests.md](rendering-tests.md) |
| **Integration** | multi-module flows | (future) | planned |
| **E2E** | on-device flows | (Maestro/EAS) | later phase |

## Where tests live

All test files live in a centralized `tests/` directory at the mobile app root,
not co-located with source files:

```
apps/mobile/
  tests/
    unit/
      components/     # component tests (*.test.tsx for render, *.test.ts for logic)
      features/       # feature-specific logic tests (*.test.ts)
      utils/          # utility function tests (*.test.ts)
      notifications/  # notification-related tests (*.test.ts)
    jest.setup.ts
```

Tests import source code via the `@/src/...` alias (e.g.
`import { formatUnreadLabel } from '@/src/components/chat/channel-list/channel-list.utils'`),
which mirrors the alias used throughout the app's source code.

The `tests/` directory is structured to leave room for future test types:

```
tests/
  unit/          # current — all unit tests
  integration/   # future — multi-module integration tests
  e2e/           # future — end-to-end on-device tests
```

## Running logic tests

```bash
cd apps/mobile
nvm use            # picks Node 22 from .nvmrc (Expo SDK 57 needs >= 22.13)
pnpm test          # runs logic tests then component tests
```

Scripts:

| Script | Purpose |
|--------|---------|
| `pnpm test` | run all unit tests (logic + component render) |
| `pnpm run test:logic` | run every `tests/unit/**/*.test.ts` once (node:test) |
| `pnpm run test:logic:watch` | re-run on change during development |

Logic tests use the Node built-in test runner (`node:test` + `node:assert/strict`)
executed through `tsx`, which strips TypeScript types on the fly. No build step
and no `jest` are involved.

## Why `--test-force-exit`

`test:logic` runs with `--test-force-exit`. This is deliberate, not a workaround
for a flaky test:

`@xyne/shared` (the workspace package `packages/shared`) starts two module-scope `setInterval` timers in its
query-cache machine — cache eviction and access-count decay — without calling
`.unref()`. Those interval handles are never assigned or exported, so nothing can
clear them from the test side. Any test that transitively imports `@xyne/shared`
therefore keeps the Node event loop alive after the tests finish, so the process
would hang forever without `--test-force-exit`.

The correct fix is to add `.unref()` to those intervals in `packages/shared`;
until then `--test-force-exit` is the supported mitigation.

## Logic / render boundary rule

`tests/unit/**/*.test.ts` files are logic tests and must stay free of rendering
concerns. ESLint (`eslint.config.mjs`) forbids importing `react`, `react-native`,
`react-dom`, `react-test-renderer`, `@testing-library/*`, and
`expo-router/testing-library` from `*.test.ts`. Component and render tests belong
to `*.test.tsx` files; see [rendering-tests.md](rendering-tests.md).
