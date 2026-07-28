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
// The backend imports the COMPILED shared/dist (e.g. MeasureSchema). The golden
// bakes shared/dist from the DEFAULT branch, so any sandbox that checks out a
// branch touching shared/ runs against a stale dist and crashes on startup
// (observed: "MeasureSchema.omit is not a function"). Rebuild shared FIRST so
// dist matches the checked-out branch. tsc is incremental (fast when unchanged),
// so this is cheap on branches that don't touch shared. `|| true` on the build
// is deliberate: a shared build failure should surface via the backend's own
// error, not silently skip the start.
const BACKEND_TEST_CMD = `(cd /workspace/xyne-spaces/shared && npm run build) ; ${TEST_CMD}`;

export const REPO_CONFIGS: Record<string, RepoSetupConfig> = {
  
  // Lightweight browser sandbox with NO repository. Pin a browser-only agent
  // (e.g. one that drives external sites via sandbox-pw-*) to this in the agent
  // UI; the pin routes sandbox-create / sandbox-run / sandbox-pw to the
  // browser-only template (headless chromium + CDP + noVNC), without cloning a
  // repo or starting dev servers. No repoUrl ⇒ the no-repo branch in
  // makeRepoSetupTool just provisions the template. See tools.ts.
  "browser": {
    slug: "sandbox-browser-setup",
    name: "Browser (no repo)",
    description:
      "Provision a lightweight browser sandbox (headless chromium + CDP + noVNC) with NO repository. " +
      "Use for web automation against external sites via the sandbox-pw-* tools. No clone, no dev servers.",
    defaultBranch: "",
    workDir: "/workspace",
    template: "agent-workspace-browser-template",
    sessionTimeoutMs: 2 * 60 * 60 * 1000,
    steps: [],
  },
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
    // Read-first: default every run to the read-only sbx-git sandbox (no
    // snapshot clone); only claim a writable dev sandbox on write:true. This is
    // what removes the default golden-snapshot clones that tripped the GCP
    // op-rate limit for xyne-spaces (the hot repo).
    // When a write sandbox IS claimed: 1 h hard lifetime cap, released after
    // 10 min of inactivity — so few concurrent golden-snapshot clones are alive
    // at once. Other repos keep their normal session/idle timeouts.
    writeSessionTimeoutMs: 60 * 60 * 1000, // 1 hour max lifetime
    writeIdleTimeoutMs: 10 * 60 * 1000,    // release after 10 min inactivity
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
        cmd: BACKEND_TEST_CMD,
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

  lotus: {
    slug: "sandbox-lotus-setup",
    name: "LotusPay Doctor Sandbox Setup",
    description:
      "Bring up the LotusPay Doctor stack (LP project) in a sandbox " +
      "(lotus-workspace-template, cloning from lotus-golden-snap-v1). " +
      "The snapshot bakes 3 repos: pluto (LP, master, nix flake), torana " +
      "(LP, master, Ruby on Rails on Ruby 2.7.4 via nixpkgs-23.11), " +
      "ashfall (LP, develop, Node frontend). Bundled gems land at " +
      "$BUNDLE_PATH (/workspace/.bundle/gems); ashfall node_modules + " +
      "pluto nix-store closure + rails deps are all warmed on the PVC. " +
      "No services auto-start; agent runs `rails s` (torana → :3000), " +
      "`npm run dev` (ashfall → :3001 / :5173 Vite), or `nix run ./#<x>` " +
      "(pluto) on demand.",
    repoUrl: "ssh://git@ssh.bitbucket.juspay.net/lp/torana.git",
    defaultBranch: "master",
    cloneDepth: 1,
    workDir: "/workspace/torana",
    template: "lotus-workspace-template",
    sessionTimeoutMs: 2 * 60 * 60 * 1000,
    idleTimeoutMs: 60 * 60 * 1000,
    readyTimeoutMs: 10 * 60 * 1000,
    auxRepos: [
      { name: "pluto",   url: "ssh://git@ssh.bitbucket.juspay.net/lp/pluto.git",   defaultBranch: "master",  workDir: "/workspace/pluto" },
      { name: "ashfall", url: "ssh://git@ssh.bitbucket.juspay.net/lp/ashfall.git", defaultBranch: "develop", workDir: "/workspace/ashfall" },
    ],
    steps: [],
    ports: {
      torana: 3000,
      ashfall: 3001,
      ashfallVite: 5173,
      pluto: 8080,
    },
  },

  lamf: {
    slug: "sandbox-lamf-setup",
    name: "LAMF Sandbox Setup",
    description:
      "Bring up the LAMF (AX) stack in a sandbox " +
      "(lamf-workspace-template, cloning from lamf-golden-snap-v1). " +
      "The snapshot bakes 3 AX repos: lamf-dashboard (npm), clms-corp " +
      "(npm), clms-retail (yarn + ReScript, `yarn re:build` finished at " +
      "bake time producing ~1906 .cmj files). node_modules for all 3 " +
      "are warmed on the PVC. No services auto-start; agent runs the " +
      "sandbox dev commands on demand:\n" +
      "  - cd lamf-dashboard && npm run dev:sandbox\n" +
      "  - cd clms-corp      && npm run dev:sandbox\n" +
      "  - cd clms-retail    && yarn start:sandbox\n" +
      "(npm install / yarn install / yarn re:build are already baked; " +
      "re-run only if package.json or .res files change.)",
    repoUrl: "ssh://git@ssh.bitbucket.juspay.net/ax/lamf-dashboard.git",
    defaultBranch: "master",
    cloneDepth: 1,
    workDir: "/workspace/lamf-dashboard",
    template: "lamf-workspace-template",
    sessionTimeoutMs: 2 * 60 * 60 * 1000,
    idleTimeoutMs: 60 * 60 * 1000,
    readyTimeoutMs: 10 * 60 * 1000,
    // Default branches confirmed from the builder Job clone: lamf-dashboard
    // is master, clms-corp is main, clms-retail is master. Override per-claim
    // via auxBranches if needed.
    auxRepos: [
      { name: "clms-corp",   url: "ssh://git@ssh.bitbucket.juspay.net/ax/clms-corp.git",   defaultBranch: "main",   workDir: "/workspace/clms-corp" },
      { name: "clms-retail", url: "ssh://git@ssh.bitbucket.juspay.net/ax/clms-retail.git", defaultBranch: "master", workDir: "/workspace/clms-retail" },
    ],
    steps: [],
    ports: {
      lamfDashboard: 3000,
      clmsAlt: 3001,
      vite: 5173,
      rescript: 8080,
    },
  },
};
 
// ───────────────────────────────────────────────────────────────────────────
// sbx-git — the SHARED, READ-ONLY, multi-repo sandbox.
//
// Scheduled / automation runs that ask for ANY repo are transparently routed
// here instead of cloning that repo's heavy golden snapshot (see
// sandboxRepoSetup in tools.ts). One long-lived shared session backs all such
// runs, so there is NO per-claim snapshot clone — which is what caused the
// GCP per-snapshot RESOURCE_OPERATION_RATE_EXCEEDED storm when many scheduled
// PR-patrol jobs fired at once.
//
// The agent is TOLD (in the sandbox-repo-setup result) that it is in this
// read-only sandbox so it greps/reads instead of trying to run/build/write.
// ───────────────────────────────────────────────────────────────────────────
export interface SbxGitConfig {
  /** Kata template the shared read-only sandbox boots from. */
  template: string;
  /** Stable key under which the single shared session is cached + reused. */
  sharedSessionKey: string;
  /** Long session lifetime — this sandbox is meant to stay up. */
  sessionTimeoutMs: number;
  /** Where each repo is checked out inside the shared pod: repoName → path. */
  repoPaths: Record<string, string>;
  /** Tools that must NOT be offered to a run pinned to this sandbox. */
  disabledTools: string[];
}

export const SBX_GIT: SbxGitConfig = {
  template: "sbx-git-template",
  sharedSessionKey: "sbx-git:shared",
  sessionTimeoutMs: 24 * 60 * 60 * 1000, // 24h; kept warm/refreshed by a cron
  // Repos cloned to /workspace/<repo> in the shared pod's prebake. MUST stay in
  // sync with the prebake clone list (02-sbx-git-prebake CM `REPOS`). This is the
  // full set mirrored from REPO_CONFIGS (every primary repoUrl + auxRepo), so any
  // read/PR/automation job can grep any repo the project sandboxes know about.
  // (PR content itself comes live from the Bitbucket MCP — the local clone is
  // for code grepping.)
  repoPaths: {
    "xyne-spaces": "/workspace/xyne-spaces",
  },
  // Read-only enforcement (belt to the FS suspenders): anything that can mutate
  // or run code is stripped from the palette for sbx-git-routed runs.
  disabledTools: [
    "sandbox-run",
    "sandbox-run-detached",
    "sandbox-write-file",
    "sandbox-create",
    "sandbox-destroy",
    "write",
  ],
};

/**
 * Read-only-job detector. Scheduled jobs and automation runs are diverted to
 * the shared sbx-git sandbox; everything else gets the normal per-project clone.
 * Mirrors the eventType checks claw already uses (run.ts:1577-78 / :1595).
 */
export function isReadOnlyJob(
  eventType: string | undefined,
  conversationId: string | undefined,
): boolean {
  const e = (eventType ?? "").trim().toLowerCase();
  if (e === "automation" || e === "scheduled_job" || e === "scheduled") return true;
  if ((conversationId ?? "").startsWith("scheduled_")) return true;
  return false;
}

/**
 * The result text returned to the agent when a run is routed to sbx-git, so the
 * model KNOWS it's read-only and adapts (grep/read, not run/build/write).
 */
export function sbxGitResultMessage(requestedRepo: string, sessionId: string, focusRepos?: string[], reason?: string): string {
  const path = SBX_GIT.repoPaths[requestedRepo];
  const allRepos = Object.keys(SBX_GIT.repoPaths);
  const available = allRepos.join(", ");
  const repoLine = path
    ? `\`${requestedRepo}\` is checked out at \`${path}\`.`
    : `NOTE: \`${requestedRepo}\` is not in this sandbox. Available repos: ${available}.`;
  // Operator-selected repo context (agent.config.sbxGitRepos). Advisory: the pod
  // is shared so all repos are on disk, but we tell the agent which ones are its
  // focus so a reviewer doesn't wander across all 44.
  const focus = (focusRepos ?? []).filter((r) => allRepos.includes(r));
  const scopeLine = focus.length > 0
    ? `YOUR REPO CONTEXT (focus here — at /workspace/<repo>): ${focus.join(", ")}. Other repos exist on disk but are out of scope for this agent unless the task clearly needs them.`
    : `All repos present: ${available} (each at /workspace/<repo>).`;
  // Why the agent landed here. Default = the scheduled/automation read-only
  // routing; the write-unavailable fallback passes its own reason so the agent
  // isn't wrongly told "this is a scheduled/automation run".
  const reasonLine = reason
    ? `You asked for the \`${requestedRepo}\` dev sandbox, but ${reason} You are now in the SHARED read-only multi-repo GIT SERVER (sbx-git) — NOT a per-project dev sandbox.`
    : `You asked for the \`${requestedRepo}\` sandbox, but this is a scheduled/automation run, so you are in the SHARED read-only multi-repo GIT SERVER (sbx-git) — NOT a per-project dev sandbox.`;
  return [
    "🔒 READ-ONLY git server (sbx-git) — NOT the main dev sandbox.",
    "",
    reasonLine,
    "",
    repoLine,
    scopeLine,
    "",
    "You CAN: read files, grep/ripgrep, find, and query Bitbucket / Grafana via their tools.",
    "You CANNOT: start services, build, run `npm`, edit/write files, or commit/push — those tools are disabled here. Do code inspection only.",
    "",
    "READING A SPECIFIC BRANCH (do NOT `git checkout` — this sandbox is shared & read-only; checkout would corrupt other runs):",
    "• For a PR's diff / files on its source branch, use the Bitbucket tools (get_pull_request_diff, file-at-ref) — they serve any branch live, no local checkout.",
    "• To grep a branch locally, read it by ref (never checkout): `git-read -C /workspace/<repo> fetch --depth 1 origin <branch>` then `git-read -C /workspace/<repo> grep origin/<branch> <pattern>` / `... show origin/<branch>:<path>`.",
    "• The local clones default to each repo's main branch (for broad code context).",
    "",
    `sessionId: ${sessionId}`,
  ].join("\n");
}
