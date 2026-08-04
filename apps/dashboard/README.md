# Dashboard

The web client for Xyne Spaces — React 19 on Vite, package name `xyne-spaces-dashboard`.

Served at **http://localhost:5173** and talks to the backend on `:3001`.

## Running it

From the repository root, so pnpm resolves the workspace:

```bash
pnpm --filter xyne-spaces-dashboard run dev
```

The dashboard needs the backend and the infrastructure containers to be up. If you have
not started them, `pnpm run up` from the root does everything — see
[Local Development](../../docs/setup/local-development.md).

Other modes:

```bash
pnpm --filter xyne-spaces-dashboard run dev:test     # against the test env
pnpm --filter xyne-spaces-dashboard run dev:prod     # against prod-local config
pnpm --filter xyne-spaces-dashboard run preview      # serve a production build
```

## Layout

```
src/
├── api/          # Backend HTTP clients
├── components/   # Reusable UI, built on Radix + Tailwind
├── pages/        # Route-level components
├── routes/       # Route definitions
├── hooks/        # Custom React hooks
├── machines/     # XState machines for multi-step flows
├── store/        # Client state
├── providers/    # Context providers (auth, theme, real-time)
├── contexts/     # React contexts
├── services/     # Cross-cutting client services
├── shortcuts/    # Keyboard shortcut registry
├── config/       # Environment-specific config
└── lib/          # Utilities
```

## How data reaches the UI

Three paths, and which one to use depends on the data:

- **[Zero](https://zero.rocicorp.dev/)** (`@rocicorp/zero`) — syncs a queryable subset
  of Postgres to the client. Reads are local and stay live, so most list and detail
  views should query Zero rather than fetch. The schema is generated from the backend's
  Prisma schema into `apps/backend/prisma/generated/zero`.
- **TanStack Query** (`@tanstack/react-query`) — REST calls to the backend for anything
  outside the Zero schema, and all mutations that are not Zero writes.
- **Y-Sweet / Yjs and LiveKit** — collaborative document and canvas editing, and audio
  and video, respectively. Both hold their own connections directly from the client.

## Editors

Two rich-text stacks coexist deliberately: **BlockNote** (`@blocknote/react`) for
documents, and **TipTap** (`@tiptap/react`) for inline composers such as messages and
comments. Match whichever the surrounding surface already uses.

## Checks

```bash
pnpm --filter xyne-spaces-dashboard run typecheck        # tsc --noEmit
pnpm --filter xyne-spaces-dashboard run lint:errors-only # what the pre-commit hook runs
pnpm --filter xyne-spaces-dashboard run validate         # typecheck + format check + lint
pnpm --filter xyne-spaces-dashboard run build            # tsc --noEmit && vite build
```

The pre-commit hook runs `lint:errors-only` and `validate` when files here change. Set
`NODE_OPTIONS="--max-old-space-size=8192"` before `build` — it needs more than Node's
default heap.

## Environment

Reads `.env.local`, created from `.env.example` by `pnpm run env:setup`. Vite only
exposes variables prefixed `VITE_` to client code.

## See also

- [Local Development](../../docs/setup/local-development.md) — full setup and workflows
- [AI Providers](../../docs/setup/ai-providers.md) — required for the AI surfaces to respond
- [Backend README](../backend/README.md) — the API this client consumes
- [API Documentation](../../API_DOCUMENTATION.md) — REST reference
