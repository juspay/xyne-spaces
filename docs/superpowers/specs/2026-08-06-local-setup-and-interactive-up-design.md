# Local Setup doc + interactive `pnpm run up` — Design

Date: 2026-08-06
Status: approved (conversation with Yash Gupta)

## Goal

1. A **Local Setup** doc that takes a machine with *nothing* installed to a running
   Xyne Spaces environment — macOS, Linux, and Windows/WSL2, end to end.
2. Make `pnpm run up` interactive: instead of six dev processes interleaved by
   `concurrently` in one stream, developers pick **which apps to run** and get a
   **multi-pane terminal TUI** (one isolated pane per process, keys to restart/stop
   each). The existing infrastructure feature picker is upgraded to the same UI.

## Research summary (what high-tech repos do)

- Cal.com, Supabase, Plane: `turbo dev` → Turborepo TUI (task sidebar + per-task panes).
- Novu: `npm start` → "Jarvis", an interactive wizard asking *what do you want to run?*
- create-vite / Svelte CLI: `@clack/prompts` wizards (multiselect, spinners, tasks).
- **mprocs**: framework-agnostic multi-pane TUI; pure npm devDependency with prebuilt
  binaries (macOS/Linux/Windows), no postinstall; process list + real pty per process;
  keys: `↑/↓` select, `r` restart, `x` stop, `s` start, `z` zoom, `Ctrl-a` focus/type
  into a process, `q` quit.
- process-compose / Overmind rejected: require brew/tmux system installs.

**Chosen approach: `@clack/prompts` pickers + `mprocs` TUI.** Least invasive (no
change to how the monorepo runs tasks), zero system dependencies, Windows-capable.

## Decisions (from brainstorming)

- Multi-pane TUI in one window; NOT separate OS terminal windows, NOT tmux.
- Bootstrap stages (env → install → secrets → services) keep today's plain output.
- Interactive app picker before the TUI; services feature picker upgraded to match.
- Feature choices inform app-picker defaults (Xyne-Claw feature → claw apps preselected).
- New doc covers macOS + Linux + Windows/WSL2 from zero.

## Constraint discovered in xyne-doctor

`xyne-doctor.mjs` runs its wrapped command with `stdio: ["inherit","pipe","pipe"]`
(output captured for the failure handoff). A full-screen TUI cannot render into a
pipe. Therefore:

- `pnpm run up` becomes **two stages**: doctor-wrapped `bootstrap:infra:raw`
  (env → setup → secrets → services), then `scripts/dev-interactive.mjs` launched
  directly with inherited stdio (real TTY).
- `dev-interactive.mjs` only starts mprocs when **both stdin and stdout are TTYs**;
  otherwise (CI, pipes, doctor-wrapped) it falls back to the existing `concurrently`
  behaviour. Nothing breaks for scripts.

## Components

### 1. `scripts/dev-interactive.mjs` (new)

- App registry: backend, worker, dashboard, claw (xyne-claw), auth (claw-auth),
  auth-ui (claw-auth-ui) — each with pnpm filter, dev script, hint, colour.
- Selection sources, in priority order:
  1. `XYNE_DEV_APPS` env (`all` or comma list) / `--all` flag → no prompt.
  2. Interactive Clack wizard: preset select (**Same as last time** / **Everything**
     / **Core** = backend+worker+dashboard / **Pick apps**) → multiselect when
     picking. Initial checks = last saved selection, else core + apps implied by
     the saved infrastructure features (claw feature → claw apps).
  3. Non-interactive with nothing specified → all apps.
- Selection persisted to `.xyne/dev-apps.json` (gitignored).
- Runner: generates `.xyne/mprocs.yaml` (`procs: { name: { shell: ... } }`) and
  spawns `pnpm exec mprocs --config .xyne/mprocs.yaml` with `stdio: inherit`.
  Fallback runner builds the `concurrently` argument list for the selected subset
  (same names/colours/kill behaviour as today's `dev:all`).
- If `mprocs` or `@clack/prompts` are not installed (e.g. half-finished install),
  degrade gracefully to the concurrently fallback with a warning.
- Pure helpers exported for tests: spec parsing, initial-selection logic, mprocs
  YAML generation, concurrently args.

### 2. `scripts/select-services.mjs` (new)

- Clack front door for infrastructure: preset select (**Everything** / **Core**
  = Chat & Tickets only / **Pick features**) → multiselect of the 8 optional
  features (Chat & Tickets always on, shown as locked).
- Persists chosen feature ids to `.xyne/features.json` (drives app-picker defaults).
- Invokes `bash scripts/start-services.sh` with `XYNE_FEATURES=<numbers>` set,
  `stdio: inherit`, and exits with its code.
- Non-interactive stdin or `XYNE_FEATURES` already set → skips straight to bash.

### 3. `scripts/start-services.sh` (edit)

- Honour `XYNE_FEATURES` (comma-separated feature numbers, `1` implied): when set,
  skip the built-in arrow-key menu entirely. The bash menu remains as fallback for
  direct `./scripts/start-services.sh` runs.
- Fix the pre-existing summary bug where features 5–9 are labelled wrongly
  (5 showed "Search" instead of "Transcription", etc.).

### 4. `package.json` (root, edit)

- devDependencies: `@clack/prompts` `^1.7.0`, `mprocs` `^0.9.6`.
- Scripts:
  - `dev:all:plain` — the old `concurrently` line (CI / escape hatch).
  - `dev:all:raw` → `node scripts/dev-interactive.mjs`.
  - `dev`, `dev:all` → `node scripts/dev-interactive.mjs` (TUI shouldn't run piped
    under doctor; doctor's `dev` preset still works via the non-TTY fallback).
  - `bootstrap:infra:raw` — `env:setup && setup && secrets && services:raw`.
  - `bootstrap:raw` — `bootstrap:infra:raw && dev:all:plain` (fully non-interactive).
  - `up` / `bootstrap` — `node scripts/xyne-doctor.mjs bootstrap-infra && node scripts/dev-interactive.mjs`.
  - `services:raw` → `node scripts/select-services.mjs`.

### 5. `scripts/xyne-doctor.mjs` (edit)

- Add `bootstrap-infra` preset → `pnpm run bootstrap:infra:raw`. `up`/`bootstrap`
  presets keep pointing at `bootstrap:raw` (now ending in `dev:all:plain`), so
  `pnpm run doctor up` stays a fully doctor-supervised non-TUI bootstrap.

### 6. Docs

- **New `docs/setup/local-setup.md`**: from-zero walkthrough — macOS (Xcode CLT,
  Homebrew, Node 22, Corepack/pnpm, OrbStack/Docker Desktop), Linux (apt build
  deps, Node 22, Docker Engine + compose), Windows (WSL2 install → Linux path,
  Docker Desktop WSL2 backend); then clone → `pnpm run up` with a section showing
  each interactive prompt (features picker, login, AI, app picker) and the mprocs
  key cheatsheet; verification (http://localhost:5173, default login) and stopping.
- `docs/setup/README.md`: add Local Setup to the path table; describe the new
  interactive flow.
- `docs/setup/local-development.md`: update the one-command path and step 5 for
  the picker + TUI; document `dev:all:plain`.

### 7. Housekeeping

- `.gitignore`: `.xyne/dev-apps.json`, `.xyne/features.json`, `.xyne/mprocs.yaml`.
- Tests: a `node --test` file for the pure helpers was written, then removed at
  the user's request; the helpers remain exported should tests return.

## Additions during implementation (user-requested mid-flight)

- **Port pre-flight** (`scripts/port-check.mjs`): before anything starts, both
  stages check the ports they are about to bind (dev apps: 3001/5173/3002/3003/5174;
  services: the `*_BIND_PORT` mappings of the selected features from
  docker-compose.dev.yml). Busy ports are reported with their owner via `lsof`.
  Dev picker offers *stop the holder (SIGTERM→SIGKILL) / continue / abort*;
  services offers *continue / abort* only (killing docker-proxy would be wrong)
  and skips the check entirely when this project's compose stack is already up
  (compose reconciles its own containers). Non-interactive runs warn and proceed
  — CI must never kill processes on its own.
- **Xyne ASCII banner** (`scripts/xyne-banner.mjs`): no wordmark existed in the
  repo (verified), so one was created — big block-letter XYNE (7 rows × 48 cols)
  in the brand's coral-red gradient (#FF4F4F, from the dashboard logo assets),
  revealed top-to-bottom (~250 ms) and then **pinned**: a DECSTBM scroll region
  keeps the logo fixed at the top while prompts and logs scroll below it. The
  region is released on exit and before mprocs takes the full screen. No-op on
  non-TTY/CI.
- **Select-all inside the multiselect**: both pickers get an explicit "All …"
  first entry that expands to every option, in addition to the "Everything"
  preset — addressing "cannot select all on the second screen". Arrow-key
  reliability comes from Clack replacing the hand-rolled bash escape parsing.

## Error handling

- Ctrl-C in a Clack prompt → clean cancel (exit 130), nothing written.
- mprocs exit code is forwarded; `q` in the TUI stops every process.
- Non-TTY stdout → concurrently fallback (CI-identical behaviour).
- Missing optional deps → warn + fallback, never crash the bootstrap chain.

## Out of scope

- Turborepo/Nx adoption; process-compose/Overmind; health-check-based startup
  ordering (services stage already waits for health before dev starts).
- Making bootstrap stages themselves a TUI (explicitly declined — plain output kept).
