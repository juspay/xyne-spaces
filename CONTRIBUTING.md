# Contributing to Xyne Spaces

Thanks for taking the time to contribute. This page covers what the tooling enforces,
so your first pull request does not bounce on something mechanical.

Participation is governed by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

Work through [Prerequisites](docs/setup/prerequisites.md) and get a running environment
via [Local Development](docs/setup/local-development.md). The short version:

```bash
git clone https://github.com/juspay/xyne-spaces.git
cd xyne-spaces
pnpm run up
```

You will also want [gitleaks](https://github.com/gitleaks/gitleaks) installed — the
pre-commit hook uses it to scan staged changes for secrets:

```bash
brew install gitleaks
```

Without it the hook prints a warning and skips the scan, so a secret can slip through
locally and be caught later in review. Install it.

## Ways to contribute

- **Report a bug** — [open a bug report](https://github.com/juspay/xyne-spaces/issues/new?template=bug_report.yml).
  Include what you ran, what happened, and the output. If it is a setup failure, check
  [Troubleshooting](docs/setup/troubleshooting.md) first.
- **Request a feature** — [open a feature request](https://github.com/juspay/xyne-spaces/issues/new?template=feature_request.yml)
  describing the problem before the solution.
- **Improve the docs** — small corrections are as welcome as code. Docs changes follow
  the same commit and PR rules below.
- **Send a fix** — for anything larger than a small fix, open an issue first so the
  approach can be agreed before you write it.

## Workflow

### 1. Branch

The pre-push hook enforces a naming pattern — pushing any other branch name is rejected:

```
fix/<short-description>
feature/<short-description>
```

```bash
git checkout -b fix/ticket-filter-reset
```

Branch names ending in `-test-reports` are reserved for the automated test-report flow
and are blocked.

### 2. Make the change

Keep the diff focused on one thing. Match the conventions of the file you are editing
rather than introducing a new style.

Two workspace rules matter more here than in a typical repo:

- **Declare what you import.** pnpm's isolated linker only exposes a package's declared
  dependencies. An import that resolves on your machine because something else pulls it
  in will fail for everyone else. Add with a filter, never a bare `pnpm add`:
  ```bash
  pnpm --filter xyne-spaces-backend add express
  ```
- **Version pins live in `pnpm.overrides`** in the root `package.json`. A pin added
  inside an individual package is ignored.

If you touch a Prisma schema, regenerate the client — the generated output is an input
to typecheck, and a stale one shows up as confusing type errors:

```bash
pnpm --filter xyne-spaces-backend run db:generate
pnpm --filter xyne-spaces-backend run db:common:generate
```

### 3. Verify locally

Run what CI runs, before you push:

```bash
export NODE_OPTIONS="--max-old-space-size=8192"   # both need more than Node's default heap

pnpm run build:shared
pnpm --filter xyne-spaces-backend   run typecheck
pnpm --filter xyne-spaces-backend   run build
pnpm --filter xyne-spaces-dashboard run lint:errors-only
pnpm --filter xyne-spaces-dashboard run typecheck
pnpm --filter xyne-spaces-dashboard run build
pnpm --filter agentic-framework     run lint
```

Tests:

```bash
pnpm --filter xyne-spaces-backend run test           # Jest
pnpm run test                                        # Playwright end-to-end suite
```

### 4. Commit

`commitlint` runs on every commit and **requires a ticket reference**. The format is:

```
<type>: <TICKET-ID> <subject>
```

```bash
git commit -m "fix: XYNE-1234 reset ticket filters when the space changes"
git commit -m "feat: PROJ-88: add ETA reminders to stage transitions"
```

- **Type** — one of `feat`, `feature`, `fix`, `docs`, `style`, `refactor`, `perf`,
  `test`, `chore`, `build`, `ci`, `revert`.
- **Ticket** — `XYNE-1234`, or any `PROJECT-1234` form. Not optional; the commit is
  rejected without one.
- **Subject** — imperative, under 200 characters for the whole header.

`pnpm exec cz` walks you through it interactively if you prefer.

**What the pre-commit hook runs**, scoped to what you actually touched:

| You changed | The hook runs |
| ----------- | ------------- |
| anything | gitleaks secret scan on staged changes |
| `apps/backend/**` | backend typecheck + build |
| `apps/dashboard/**` | dashboard lint + validate |
| `packages/framework/**` | framework lint |
| `tools/xyne-automation/**` | automation validate |
| nothing above | a basic dashboard lint |
| anything | service change analysis + schema-migration validation |

It is slow on a large change, which is deliberate — it is the same set CI runs.

If gitleaks flags a value that is genuinely safe (a public config value, a fixture),
allowlist it in `.gitleaks.toml` under `[allowlist]` rather than bypassing the hook.
The allowlist change is visible in your PR, which is the point.

### 5. Open a pull request

Push and open a PR against `main`. Fill in the template: what changed, why, how you
tested it, and the ticket reference.

- Keep PRs small enough to review in one sitting.
- If your change alters setup, ports, env vars, or commands, **update the docs in the
  same PR** — `docs/setup/` and the README are treated as part of the change, not
  follow-up work.
- CI must be green before review. A red build is yours to fix.

## Reporting a security issue

Do not open a public issue for a security vulnerability. Report it privately through
[GitHub Security Advisories](https://github.com/juspay/xyne-spaces/security/advisories/new)
so it can be fixed before disclosure.

## License

By contributing, you agree that your contributions are licensed under the
[Apache License 2.0](LICENSE), the same license as this project.
