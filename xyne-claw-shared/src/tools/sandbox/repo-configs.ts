import type { RepoSetupConfig } from "./tools.js";

/**
 * Centralized repository setup configurations.
 * Single source of truth for all repo sandbox setups.
 *
 * To add a new repo:
 * 1. Add config object to REPO_CONFIGS
 * 2. Tools are auto-registered in registry.ts
 */

// Branches that have the `claw:test` script (sandbox-specific test mode with
// SANDBOX_TEST_MODE / VITE_SANDBOX_TEST_MODE) prefer it; older branches fall
// back to plain `dev:test`. Use `if/then/else/fi` rather than `cmd && a || b`
// so a real failure inside `claw:test` doesn't silently re-run `dev:test`.
const TEST_CMD = `if grep -q '"claw:test"' package.json; then npm run claw:test; else npm run dev:test; fi`;

export const REPO_CONFIGS: Record<string, RepoSetupConfig> = {
  
  "xyne-spaces": {
    slug: "sandbox-xyne-spaces-setup",
    name: "Xyne Spaces Sandbox Setup",
    description:
      "Full automated setup of the xyne-spaces development environment inside an agent-workspace " +
      "(gVisor-targeted, Nix-driven) sandbox. The pod prebakes the repo + node_modules + Nix " +
      "service derivations at boot, so this tool just refreshes onto the requested branch, " +
      "starts services (postgres :5433, redis :6379, livekit :7880, zero :4848, fake-gcs :4443, " +
      "y-sweet :8080) via `just services`, then launches backend (:3001) and dashboard (:5173) " +
      "in the background. Returns sessionId + jobIds for backend and dashboard.",
    repoUrl: "ssh://git@github.com/example-org/xyne-spaces.git",
    defaultBranch: "main",
    cloneDepth: 1,
    workDir: "/workspace/xyne-spaces",
    template: "agent-workspace-gvisor-template",
    sessionTimeoutMs: 2 * 60 * 60 * 1000,
    idleTimeoutMs: 60 * 60 * 1000,
    readyTimeoutMs: 10 * 60 * 1000,
    steps: [
      // No install step — the pod's prebake already runs `npm ci` for
      // shared/backend/dashboard at startup. Re-running it on every
      // sandbox-repo-setup is wasted work since lockfiles match the
      // default branch's bake. If a branch checkout brings in lockfile
      // drift, the agent can run `npm ci` explicitly via sandbox-run.
      {
        type: "services",
        // `just services` would re-invoke process-compose with TUI mode
        // enabled, which crashes with `terminal entry not found: term
        // not set` when run via runDetached (no tty). Calling nix run
        // directly with --tui=false sidesteps that and gives clean log
        // output to /home/nixuser/workspace/xyne-spaces/.logs/*.log.
        cmd: "cd /workspace/xyne-spaces && nix run .#xyne-space-services -- --tui=false",
        // entrypoint.sh's prebake launches services and drops
        // /tmp/services-up when postgres/redis/zero are listening. If
        // the marker is present, this step skips the launch (process-
        // compose can't bind to already-occupied ports) and just runs
        // the healthCheck so the caller still sees confirmation.
        markerPath: "/tmp/services-up",
        healthCheck: {
          // Probe ONLY the load-bearing services for the dev flow:
          //   postgres :5433, redis :6379, zero-cache :4848.
          // Livekit/fake-gcs/y-sweet/transcription-agent come up too but
          // backend / dashboard don't strictly need them to start; we
          // skip them so a slow optional service doesn't fail the gate.
          // No `docker ps` — there's no dockerd in agent-workspace.
          cmd: "for p in 5433 6379 4848; do nc -z 127.0.0.1 $p || { echo MISSING:$p; exit 0; }; done; echo all-up",
          successCondition: "all-up",
          intervalMs: 5_000,
          timeoutMs: 5 * 60_000,
        },
      },
      {
        type: "devserver",
        name: "backend",
        // Prefer `claw:test` when the branch has it (sets
        // SANDBOX_TEST_MODE on top of NODE_ENV=test); otherwise fall back
        // to `dev:test` which still registers the /api/test/auth/login
        // route the testing skill relies on. Plain `npm run dev`
        // hardcodes NODE_ENV=development, so wrapping with `NODE_ENV=test`
        // from outside is ignored.
        cmd: TEST_CMD,
        cwd: "/workspace/xyne-spaces/backend",
        // entrypoint.sh prebake runs the same test command; this skips a
        // duplicate start (port 3001 EADDRINUSE) when the marker is
        // present.
        markerPath: "/tmp/backend-up",
      },
      {
        type: "devserver",
        name: "dashboard",
        // Vite test mode — frontend auth guards check
        // import.meta.env.MODE === 'test' (dashboard/src/config.ts)
        // before allowing the deterministic test-login flow. `claw:test`
        // additionally exposes VITE_SANDBOX_TEST_MODE; older branches
        // without it fall back to `dev:test`.
        cmd: TEST_CMD,
        cwd: "/workspace/xyne-spaces/dashboard",
        markerPath: "/tmp/dashboard-up",
      },
    ],
    ports: { backend: 3001, dashboard: 5173 },
  },
};