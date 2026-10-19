# Mobile test setup — Component rendering tests

This document describes the **component rendering test layer** for the Xyne
Spaces mobile app. These tests render real React Native components in a Node
environment and assert on what the user would see — with no emulator, device, or
Metro bundler.

It builds on the logic test layer documented in
[`logic-tests.md`](logic-tests.md).

## Test layers

| Layer                 | What it covers               | Runner                                       | Status       |
| --------------------- | ---------------------------- | -------------------------------------------- | ------------ |
| **Static**            | typecheck + lint + format    | `tsc`, `eslint`, `prettier`                  | present      |
| **Unit — logic**      | pure functions & reducers    | `node:test` via `tsx`                        | present      |
| **Unit — components** | component render + behaviour | **jest-expo + React Native Testing Library** | **this doc** |
| **Integration**       | multi-module flows           | (future)                                     | planned      |
| **E2E**               | on-device flows              | (Maestro/EAS)                                | later phase  |

## Where tests live

All test files live in a centralized `tests/` directory (see
[logic-tests.md](logic-tests.md) for the full layout). Component rendering tests
are in `tests/unit/components/` and import source code via the `@/src/...`
alias.

## Running component tests

```bash
cd apps/mobile
nvm use              # Node 22 from .nvmrc (Expo SDK 57 needs >= 22.13)
pnpm run test:render # jest (jest-expo preset)
```

`pnpm test` runs **both** unit test types — logic first, then component render.

| Script                      | Purpose                                          |
| --------------------------- | ------------------------------------------------ |
| `pnpm run test:render`      | run every `tests/unit/**/*.test.tsx` once (jest) |
| `pnpm run test:render:watch`| re-run on change during development              |
| `pnpm test`                 | run logic tests **and** component render tests   |

## How it is wired

| Piece        | File                   | Notes                                                                                                            |
| ------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Jest config  | `jest.config.js`       | `jest-expo` preset; `testMatch` scoped to `tests/unit/**/*.test.tsx`; `@/*` module alias mirrors `tsconfig.json` |
| Global setup | `tests/jest.setup.ts`  | placeholder for shared native-module mocks; RNTL v13 registers its matchers automatically                        |
| Toolchain    | `package.json` devDeps | `jest-expo@57.0.2`, `jest@29`, `@testing-library/react-native@13`, `react-test-renderer@19.2.3`, `@types/jest`   |

### The logic / render file-extension boundary

The two unit test types are split purely by file extension, so the runners never
collide:

- **`*.test.ts` → logic tests**, executed by `node:test` (`test:logic`).
- **`*.test.tsx` → component render tests**, executed by jest (`test:render`).

`jest.config.js` sets `testMatch: ['<rootDir>/tests/unit/**/*.test.tsx']` so
jest never picks up the logic test files, and ESLint enforces the reverse:
`*.test.ts` may not import rendering libraries (see `eslint.config.mjs`).

### Version pinning — jest-expo 57.0.2

`jest-expo` is pinned to **57.0.2**, not the latest 57.0.x. The app runs on
`react-native@0.86.0`, whose optional peer is
`@react-native/jest-preset@0.86.0`. `jest-expo@57.0.3+` bumped that peer to
`^0.86.2`, which conflicts with the app's pinned React Native patch.
`jest-expo@57.0.2` depends on `@react-native/jest-preset@^0.86.0`, which
resolves cleanly against `0.86.0` without `--legacy-peer-deps`.
`react-test-renderer` is likewise pinned to the app's exact React version
(`19.2.3`).

## Writing a component test

Import the jest globals explicitly (mirroring the logic test convention of
importing from `node:test`), render the component, and assert on visible output:

```tsx
import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react-native';

import { ChannelListUnreadBadge } from '@/src/components/chat/channel-list/channel-list-unread-badge';

describe('ChannelListUnreadBadge', () => {
  it('caps counts above 99 as "99+"', () => {
    render(<ChannelListUnreadBadge count={128} />);
    expect(screen.getByText('99+')).toBeTruthy();
  });
});
```

## Notes

- **Styling is not asserted.** `className` (uniwind) is a Metro-time transform;
  under jest it is inert, so tests assert rendered text and structure, not
  styles.
- **CI.** The `mobile` job in `.github/workflows/ci.yml` runs lint, format check,
  typecheck and `pnpm test` on every pull request.

### `@xyne/shared` in rendering tests

The `@xyne/shared` root barrel re-exports the Zero schema, which imports
`@rocicorp/zero` (ESM-only) at load time; jest cannot parse it. A component or
hook that only needs an enum (`TicketStatusV2`, `TicketPriority`, …) is tested
by mapping the barrel to the stub in `tests/mocks/xyne-shared.ts`, which carries
the exact runtime values:

```ts
jest.mock('@xyne/shared', () => require('../../../mocks/xyne-shared'));
```

Add members to the stub as new tests need them. Modules that need the real Zero
client are mocked at their own boundary (`@/src/hooks/useCachedQuery`,
`@/src/zero/queries`) instead.

### Dynamic `import()` under jest

`babel-preset-expo` leaves `import()` untouched because jest's Babel caller
advertises dynamic-import support, which only holds under
`--experimental-vm-modules`. `babel.config.cjs` adds a test-env-only plugin that
rewrites `import(x)` to `Promise.resolve().then(() => require(x))`, so lazily
loaded screens (`src/features/channel-tickets/load.ts`) render in tests. A tree
that suspends at the very root is not observable through react-test-renderer;
wrap the `Suspense` boundary in a host `View` and flush one `act()` turn after
render (see `tests/unit/features/channel-tickets/load.test.tsx`).
