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

Open http://localhost:5173 (or the port printed by Vite), choose **Sign in with
Email**, and use the seeded local account:

- Email: `admin@xyne.ai`, or `DEFAULT_ADMIN_EMAIL` from `apps/backend/.env.local`.
- Password: `xynelocal@123`.

Wait for the `db-setup` service to finish seeding before signing in. **Google
sign-in is not configured for a standard local checkout**: the sample OAuth
credentials produce Google's `401 invalid_client` / “OAuth client was not found”
error. You do not need Google OAuth credentials for local email/password login.

The backend health endpoint is http://localhost:3001/api/health.

`just prepare` creates missing env files, installs the workspace, builds its shared
libraries, generates local secrets, and generates both Prisma clients. Backend and
dashboard recipes also run preparation before launching. After changing the Nix
environment, exit and re-enter `nix develop` so commands inherit the new variables.

## Automatic shell loading with direnv

The repository already tracks an [`.envrc`](../../.envrc). With direnv,
nix-direnv, and your shell's direnv hook configured, enable it from the repository
root:

```bash
direnv allow
```

It loads the flake development shell and, when present,
`apps/backend/.env.local`. You can then run `just prepare`, `just services`,
`just backend`, and `just dashboard` without manually entering `nix develop` in
each terminal. Keep services, backend, and dashboard in separate terminals as
above.

Run `direnv reload` after preparation creates local secrets or after changing
your environment configuration. Review changes to `.envrc` before approving
them again with `direnv allow`.

## Access over a LAN or Tailscale

Set `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` to your hostname in the local
`apps/backend/.env.local`, then run `direnv reload`. In
`apps/dashboard/.env.local`, enable the development proxy:

```dotenv
VITE_DEV_PROXY=true
VITE_API_BASE_URL=http://127.0.0.1:3001
VITE_ZERO_SERVER=http://127.0.0.1:4848
VITE_ENABLE_REMOTE_LOGGING=false
VITE_ENABLE_OTEL_METRICS=false
```

Restart the dashboard and use the port printed by Vite. API and Zero requests
then use the dashboard's own origin, with Vite forwarding them to the local
services. This avoids production URL inference and cross-origin API requests.
The telemetry switches disable exports to collectors absent from the native
stack. Keep machine-specific values in these gitignored files.

Add the dashboard's exact origin (scheme, hostname, and actual Vite port) to
`CORS_ORIGIN` in `apps/backend/.env.local`, preserving existing entries, then
restart the backend. WebSocket handshakes enforce this allow-list even through
the development proxy. If Vite moves from 5173 to 5174, update the allowed origin.

## Services and scope

`just services` runs PostgreSQL on 5433, Redis on 6379, LiveKit on 7880, Zero on
4848, Y-Sweet on 8080, fake GCS on 4443, and the transcription agent on 8001. Database
setup creates/syncs the app and common databases and seeds ACLs and app permissions.
It stops on schema changes that would require data loss; normal startup does not
reset your database.

This native stack does not include the full Docker feature set: Claw/Auth, Vespa,
MinIO, recording egress, and observability require additional setup. AI and actual
transcription also need provider credentials; see [AI providers](ai-providers.md).

The default Ask AI v2 flow requires Claw/Auth, not just an LLM API key. Without
that service, agent and conversation requests return 503, while `/claw/api/v1`
and daily-brief requests can return 500. A working login does not mean the AI
stack is running. Configure and start Claw/Auth before testing Ask AI.

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
