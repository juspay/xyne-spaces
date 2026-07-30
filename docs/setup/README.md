# Setup Guide

Everything needed to get Xyne Spaces running. Start here, then follow the page that
matches what you are doing.

## Pick your path

| I want to… | Go to |
| ---------- | ----- |
| Check I have the right tooling | [Prerequisites](prerequisites.md) |
| Get a full local environment running | [Local Development](local-development.md) |
| Understand what each background service does | [Services](services.md) |
| Fix something that broke | [Troubleshooting](troubleshooting.md) |

## The short version

If you already have Node 22, pnpm 10.15.0, and Docker running:

```bash
pnpm install
pnpm run up
```

`pnpm run up` is an alias for `pnpm run bootstrap`, which chains every setup step from
[Local Development](local-development.md) in order. Each is also runnable on its own:

| Step | Command | What it does |
| ---- | ------- | ------------ |
| 1 | `pnpm run env:setup` | Copies each app's `.env.example` to the filename that app reads; never overwrites an existing file |
| 2 | `pnpm run setup` | Installs the workspace and builds `@xyne/shared`, `@xyne/icons`, `agentic-framework` |
| 3 | `pnpm run secrets` | Fills the `set-me` placeholders in `apps/backend/.env.local` (JWT, encryption, VAPID) |
| 4 | `pnpm run services` | Starts infrastructure containers and waits for health checks |
| 5 | `pnpm run dev:all` | Runs backend, dashboard, xyne-claw, and claw-auth together |

Steps run serially and the chain stops at the first failure, so a broken step is never
masked by a later one. Every step is idempotent — re-running `bootstrap` on an existing
checkout is safe and will not overwrite env files or real secrets.

Stop the infrastructure with `pnpm run services:stop`.

## How the workspace fits together

This repository is a single [pnpm workspace](https://pnpm.io/workspaces). One
`pnpm install` at the root installs every package from one `pnpm-lock.yaml` — there
is no per-package install step.

Two consequences worth knowing before you start:

- **Build the libraries before the apps.** `apps/backend` and `apps/dashboard` import
  `@xyne/shared` and `@xyne/icons` from their compiled `dist/`, not their source. If
  you skip `pnpm run build:shared`, typechecks fail with unresolved imports.
- **Dependencies must be declared.** pnpm's isolated linker only exposes what a
  package declares in its own `package.json`. Code that imports an undeclared
  package will fail to resolve even though it is present elsewhere in the workspace.

## Running one thing at a time

Filters target a single workspace package by its **package name**, which is not
always the directory name:

```bash
pnpm --filter xyne-spaces-backend   run dev
pnpm --filter xyne-spaces-dashboard run dev
pnpm --filter xyne-claw             run dev
```

| Directory | Package name |
| --------- | ------------ |
| `apps/backend` | `xyne-spaces-backend` |
| `apps/dashboard` | `xyne-spaces-dashboard` |
| `apps/dashboard-external` | `xyne-spaces-dashboard-external` |
| `apps/electron` | `xyne-spaces-electron` |
| `apps/xyne-claw` | `xyne-claw` |
| `apps/xyne-claw-auth/backend` | `xyne-claw-auth` |
| `apps/xyne-claw-auth/frontend` | `xyne-claw-auth-ui` |
| `packages/shared` | `@xyne/shared` |
| `packages/icons` | `@xyne/icons` |
| `packages/framework` | `agentic-framework` |
| `packages/kata-sdk` | `@xyne/kata-sdk` |

Appending `...` to a filter includes that package's workspace dependencies, which is
what CI uses to install only the subtree a job needs:

```bash
pnpm install --frozen-lockfile --filter xyne-spaces-backend...
```
