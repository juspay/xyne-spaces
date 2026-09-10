# Local development with Nix

Install Nix with `nix-command` and `flakes` enabled, then run from the repository
root:

```bash
nix develop
just prepare
just services
```

Leave services running. In two more terminals, enter the same checkout and run:

```bash
nix develop
just backend
```

```bash
nix develop
just dashboard
```

Open http://localhost:5173. The seeded local login is `admin@xyne.ai` /
`xynelocal@123` (or the email in `DEFAULT_ADMIN_EMAIL`). The backend health endpoint
is http://localhost:3001/api/health.

`just prepare` creates missing env files, installs the workspace, builds its shared
libraries, generates local secrets, and generates both Prisma clients. Backend and
dashboard recipes also run preparation before launching. After changing the Nix
environment, exit and re-enter `nix develop` so commands inherit the new variables.

## Services and scope

`just services` runs PostgreSQL on 5433, Redis on 6379, LiveKit on 7880, Zero on
4848, Y-Sweet on 8080, fake GCS on 4443, and the transcription agent on 8001. Database
setup creates/syncs the app and common databases and seeds ACLs and app permissions.
It stops on schema changes that would require data loss; normal startup does not
reset your database.

This native stack does not include the full Docker feature set: Claw/Auth, Vespa,
MinIO, recording egress, and observability require additional setup. AI and actual
transcription also need provider credentials; see [AI providers](ai-providers.md).

The service launcher cleans occupied development ports before starting. Quit its
process manager to stop services. **`just cleanup` and `just reset` delete local
data**; use them only when you intend to start from an empty database.

## Nix-specific runtime configuration

- Linux Prisma engines are pinned to Prisma 5.22.0 and patched for Nix. The shell
  and service environment set `PRISMA_QUERY_ENGINE_LIBRARY` and
  `PRISMA_SCHEMA_ENGINE_BINARY`. Do not suppress checksum errors: a `linux-nixos`
  download attempt means these variables are missing, usually because the shell
  was not re-entered. Both the npm version and `nix/prisma-engines.nix` must be
  updated together when upgrading Prisma.
- LiveKit uses loopback addresses for Redis and backend webhooks. `just prepare`
  replaces published sample LiveKit keys with random local values. LiveKit and the
  transcription agent read the backend env file at runtime, keeping secrets out
  of the Nix store. Existing custom keys are preserved.
- On Linux, the transcription process gets the C++ runtime and zlib library paths
  needed by native Python wheels. The first launch installs its Python dependencies
  and may take several minutes; its readiness probe allows up to 15 minutes for
  this initial setup. Zero creates its replica directory itself, including when
  started directly by the smoke test.

## Verification

```bash
nix flake check --no-build
nix build .#xyne-space-services
nix develop --command just prepare
# Stop any running local services/backend before this command:
nix run .#nix-smoke-test
```

The smoke test starts the generated service commands and backend, checks LiveKit,
transcription and Zero health, and requires both databases to be connected in the
backend health response. It stops its own processes afterward and preserves data.
Logs are in `.logs/nix-smoke/` and `.logs/`. It refuses occupied ports; it does not
kill unrelated processes. To check the backend against services you already have
running, use `nix run .#nix-smoke-test -- --existing-services`.

The [Nix CI workflow](../../.github/workflows/nix-ci.yml) runs these checks on Linux
for pull requests, protected-branch pushes and `fix/nix-*` branches. It also supports
manual dispatch and uploads logs on failure. This is a startup check, not a full UI,
provider, or call-transcription integration test. macOS and ARM runtime behavior
are not covered by the Linux CI job.
