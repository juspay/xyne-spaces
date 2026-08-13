# Troubleshooting

## Install and workspace

### `ERR_PNPM_OUTDATED_LOCKFILE`

The lockfile does not match a `package.json`. Someone added a dependency without
committing the regenerated lockfile.

```bash
pnpm install --no-frozen-lockfile   # updates pnpm-lock.yaml
```

Commit the resulting `pnpm-lock.yaml` alongside the manifest change. CI installs with
`--frozen-lockfile`, so a drifted lockfile fails the build rather than silently
resolving.

### `Cannot find module 'x'` for a package that is clearly installed

The importing package does not **declare** `x`. pnpm's isolated linker only exposes
declared dependencies, so an import that worked under npm's flat `node_modules` can
fail here.

```bash
pnpm --filter <package-name> add x
```

This is a real bug being surfaced, not a pnpm limitation — the code was relying on a
dependency it never declared.

### A `pnpm.overrides` / `overrides` entry seems to be ignored

Only the **root** `package.json` overrides apply. An `overrides` block in a workspace
package is inert. Move the pin to `pnpm.overrides` in the root manifest.

### `Cannot find type definition file for 'node'` / `'jest'`

The package's `tsconfig.json` pins `typeRoots` to `./node_modules/@types`, which under
isolated linking contains only that package's own declared `@types`. Either declare
the missing `@types/*` package, or add an explicit `types: [...]` array listing what
the package actually needs.

### A stray `package-lock.json` or `node_modules` appeared

Someone ran npm. Remove both and reinstall:

```bash
rm -rf package-lock.json node_modules
pnpm install
```

## Build

### `tsc` aborts with exit code 134

Node's default heap (~2 GB) is exhausted. The backend typecheck and the dashboard
build both need more:

```bash
export NODE_OPTIONS="--max-old-space-size=8192"
```

### Unresolved imports of `@xyne/shared` or `@xyne/icons`

Those packages are consumed from their compiled `dist/`, which does not exist yet:

```bash
pnpm run build:shared
```

### Prisma type errors after a schema change

The generated client is stale:

```bash
pnpm --filter xyne-spaces-backend run db:generate
pnpm --filter xyne-spaces-backend run db:common:generate
```

## Services

### Port already in use

Something is bound to a port the stack needs — most often a system Postgres on 5432
or another project's Redis on 6379.

```bash
lsof -i :5433
pnpm run services:stop
```

### Containers start then immediately exit

Check the logs for the specific service; health checks mask the real error:

```bash
docker compose -f docker-compose.dev.yml logs zero-cache
```

`zero-cache` is the usual suspect — it depends on Postgres being migrated first, so a
failed migration surfaces here rather than in Postgres.

### `JWT_SECRET environment variable is required and must be at least 32 characters`

`apps/backend/.env.local` still holds the `set-me` placeholders from `.env.example`.
This happens when the file was copied by hand, or carried over from a checkout that
predates secret generation.

```bash
pnpm run secrets
```

That fills `JWT_SECRET`, `ZERO_AUTH_SECRET`, and `ENCRYPTION_KEY`.
It only touches placeholder or empty values, so it is safe to run against an
`.env.local` that already contains real secrets.

To check which values are still placeholders without printing them:

```bash
grep -nE '=(set-me|changeme|placeholder)$' apps/backend/.env.local
```

### Backend cannot reach the database

Confirm Postgres is healthy and that `DATABASE_URL` in `apps/backend/.env.local`
points at **5433**, not 5432:

```bash
docker compose -f docker-compose.dev.yml ps postgres
```

### Disk exhausted

Docker build caches and volumes accumulate quickly with this many services:

```bash
pnpm run cleanup
docker builder prune -af    # reclaims build cache; next build starts cold
```

## Docker builds

### `"/apps/backend" not found` during a build

The path is excluded by `.dockerignore`. Entries there are relative to the build
context (the repo root), and a bare directory name excludes the whole tree.

### `corepack enable` fails with `EACCES`

Corepack cannot symlink into a system Node prefix. Install pnpm into a user-writable
location instead — see [prerequisites](prerequisites.md#installing-pnpm).

### `prepare` hooks fail during a Docker install

Dockerfiles copy manifests before sources for layer caching, so `prepare` scripts that
run `tsc` have nothing to compile. The install step uses `--ignore-scripts`, with the
build done explicitly after the source `COPY`. Preserve that ordering when editing.

## Still stuck?

Reset to a clean state — this discards node_modules and all container state:

```bash
pnpm run services:stop
find . -name node_modules -type d -prune -exec rm -rf {} +
pnpm install
pnpm run up
```
