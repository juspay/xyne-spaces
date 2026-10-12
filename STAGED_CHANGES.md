# Staged Changes — file-by-file summary

Branch: `feature/automation-fixes` (cherry-pick in progress)
21 files, +1157 / −109

---

## Config / tooling

### `.github/workflows/ci.yml`
- CI now invokes the summary-report builder as **TypeScript** via `pnpm exec ts-node` (compiled from the TS rewrite below) instead of running the old `.mjs` directly with `node`.
- Resolves `RUN_DIR` with `realpath` first, then `cd`s into `tools/xyne-automation` to run the script — needed because the ts-node project context lives there.

### `package.json`
- Adds a new `test:headed` npm script wired to the new `tools/xyne-automation/scripts/run-headed.sh`.

### `packages/shared/package-lock.json` (new, +692)
- New lockfile for the `packages/shared` workspace.

### `tools/xyne-automation/manifest.json`
- Pure formatting: `Plugins` array collapsed to a single line (`["html-report", "json-report"]`).

---

## Automation scripts

### `tools/xyne-automation/scripts/build-summary-report.mjs → build-summary-report.ts`
- Full rewrite from JS to TypeScript.
- Adds explicit interfaces: `StepResult`, `Item`, `Scenario`, `Spec`, `SuiteResult`, `RetryRecovery`, `RunMetadata`, `FailureEntry`.
- Reorders declarations so `readJson` is defined before use.
- Replaces the dynamic `scenario[k]` loop over `beforeScenarioHookFailure` / `afterScenarioHookFailure` with explicit property checks (type-safe).
- Hardens defaulting of possibly-undefined fields (`skippedScenariosCount ?? 0`, `executionTime ?? 0`, `executionStatus ?? ''`).
- Adds biome ignore for intentional console use; cosmetic reflow of long one-liners into readable multi-line forms.
- No behavior change — output HTML is equivalent.

### `tools/xyne-automation/scripts/run-gauge.ts`
- New env-var escape hatch: `INCLUDE_QUARANTINE=true` skips the `--tags <quarantine-filter>` arg so a run can intentionally include known-flaky quarantined scenarios (useful when checking whether a quarantine is still warranted).
- Minor reformat of the `retry-recovery.json` write.

### `tools/xyne-automation/scripts/run-headed.sh` (new, +139)
- New top-level entry point for **headed-mode local runs on macOS**.
- Allocates random host ports (via a Node snippet that opens N `listen(0)` sockets simultaneously to guarantee distinct ports) and exports them as the `*_BIND_PORT` env vars the compose files consume.
- Writes `apps/dashboard/.env.test.local` with `VITE_API_BASE_OVERRIDE=/api` so the dashboard's vite preview proxies API traffic same-origin — avoids the hard-coded `localhost:3001/api` in the committed bundle and keeps `BACKEND_BIND_PORT` randomizable (no port collisions, parallel runs OK).
- Brings up only `backend / dashboard / ysweet / zero-cache / livekit / fake-gcs` (no `--profile gauge`, so the automation container stays out — that container has no display).
- Discovers each service's actual host port and builds a Chromium `--host-resolver-rules` MAP list so the host browser can resolve container hostnames (`backend:3001`, `ysweet:8080`, …) to `127.0.0.1:<host-port>`.
- Runs `scripts/run-gauge.ts` on the host with `HEADLESS=false`, `BROWSER_HOST_RESOLVER_RULES=…`, `BACKEND_URL`, `DASHBOARD_URL` all set.
- Cleans up the compose project and the dashboard env file on exit/INT/TERM.

### `tools/xyne-automation/scripts/runner/ports.ts`
- Adds three new managed port vars: `VICTORIALOGS_ERRORS_BIND_PORT`, `FLUENT_BIT_HTTP_BIND_PORT`, `FLUENT_BIT_FORWARD_BIND_PORT` (observability sidecar wiring).

---

## Automation fixtures

### `tools/xyne-automation/fixtures/baseline.ts`
- `gotoChatViewUntilReady`: swaps `waitUntil: 'networkidle'` → `'domcontentloaded'` on both the initial `goto` and the retry `reload` — networkidle is unreliable under persistent WebSocket traffic (zero-cache, livekit).
- `createProject`: drops the `waitForLoadState('networkidle')` after sidebar click; the subsequent 60s `waitFor` on the "New" button is the real readiness gate. Adds a comment explaining why.
- Minor reformat of a chained `.locator().innerText().catch()` call.

---

## Shared test infrastructure

### `tools/xyne-automation/tests/shared/support/message-hover.ts` (new, +36)
- New helper `dispatchHoverEvents(el)` + `HoverTarget` type.
- Browser-side payload for `Locator.evaluate` — dispatches **real** `pointermove`/`pointerover`/`mousemove`/`mouseover` events on a message row.
- Required because the dashboard's shared `MessageHoverToolbar` is a delegated listener on `chat-message-list` with a `pointer` modality guard — plain `dispatchEvent('mouseover')` does not flip modality so the overlay never mounts.
- Returns diagnostic info (testid, messageId, hoverKey, bounding rect) for debugging.

### `tools/xyne-automation/tests/shared/browser.steps.ts`
- `clickOnSelector` (`clicking on <selector>`): now waits for `attached` first, then `scrollIntoViewIfNeeded()`, before waiting for `visible`. Fixes cases where the element is attached but off-screen inside nested panel scrollers.
- **New step** `clicking on <selector> if visible`: fail-silent conditional click for optional UI (collapsed sections, dismissible banners). Short 2s attach grace period, scrolls into view, then force-clicks; swallows all errors.
- `clickHoverActionOnMessage`: rewrites the "atomic hover-and-click" implementation.
  - Removes the old synthetic `mouseover`/`mouseenter` approach (comments explained it was a bulletproof fix for the old per-bubble `HoverActionsToolbar`).
  - Replaces with the new shared-toolbar reality: delegates to `dispatchHoverEvents` from `message-hover.ts`, retries up to 3× with scroll-into-view + re-dispatch per attempt.
  - Updated docstring reflects the shared `MessageHoverToolbar` architecture and the pointer-modality guard requirement.

### `tools/xyne-automation/tests/shared/support/browser-manager.ts`
- Launches Chromium with an optional extra arg: `--host-resolver-rules=$BROWSER_HOST_RESOLVER_RULES` when the env var is set. Used by the headed-on-host runner to redirect container hostnames to localhost ports.

---

## Test specs & step files

### `tools/xyne-automation/tests/02_ui/02_navigation/02_admin-navigation.spec`
- Updates the "quarantined" scenario's navigation steps to match a UI redesign:
  - `tickets` → `list-projects` sidebar target.
  - Waits for `[data-testid='list-projects-page']`.
  - Clicks a `[data-testid^='project-card-']` instead of a `[data-testid^='project-item-']` under a `projects-section` accordion.
  - Adds a new `[data-track-name='Open_Board_Row']` click before asserting `projects-board-page`.

### `tools/xyne-automation/tests/02_ui/04_input-box/01_inputbox-editing.spec`
- Removes `tags: quarantine` from "List creation and navigation work" — scenario is being un-quarantined.
- Replaces `pressing Cmd+Enter in inputbox` with an explicit click on `[data-testid='send-message-button']` for the send action (keyboard shortcut was flaky).

### `tools/xyne-automation/tests/02_ui/04_input-box/inputbox.steps.ts`
- `typing <text> in link url input`: replaces the plain `locator.fill()` with a `waitFor(visible)` + evaluate that uses the **native `value` setter + dispatches a React-shaped `input` event** so controlled inputs' `useState` picks up the new value. Needed for LinkDialog's Apply flow where the button reads state at click time.
- `clicking apply link button`: after click, waits for `[data-testid='message-input'] a` to be visible and sleeps 300 ms — the dialog closes and the href is committed in a microtask after the click, so the next verify step was reading stale DOM.

### `tools/xyne-automation/tests/03_e2e/03_project/01_project-creation.spec`
- `[data-testid='edit-board-button']` → `[data-testid='board-actions-button']` (selector updated after UI rename).

### `tools/xyne-automation/tests/03_e2e/05_messaging/messaging.steps.ts`
- `clickHoverActionOnMessage`: swaps `message.hover({ force: true })` → `message.evaluate(dispatchHoverEvents)` from the new shared helper.
- Updated comment explains the shared `MessageHoverToolbar` delegation model; retry loop structure preserved.
- Minor reformat of the final `throw` block.

### `tools/xyne-automation/tests/03_e2e/06_tickets/tickets.cpt`
- Both "Creating sub-ticket …" concepts now click on `[role='tab']:has-text('Relationships')` (via the new **if-visible** step) before clicking `create-sub-ticket-button`. The Relationships tab needs to be active for the sub-ticket button to be rendered; the conditional click leaves scenarios where it's already active unaffected.

### `tools/xyne-automation/tests/03_e2e/07_canvas/01_channel-canvas.spec`
### `tools/xyne-automation/tests/03_e2e/07_canvas/02_dm-canvas.spec`
### `tools/xyne-automation/tests/03_e2e/07_canvas/canvas.cpt`
- All three: replace `clicking on text "New Canvas"` with `clicking on "[data-track-name='Create_Canvas']"` — more stable than localized button text.

---

## Themes

- **Headed-mode local runs**: new `run-headed.sh` + browser-manager host-resolver support + `test:headed` npm script + runner port vars for the new observability services.
- **UI selector refresh**: multiple specs updated for renamed/reorganized dashboard components (list-projects card, Create_Canvas track, board-actions-button, Relationships tab).
- **Hover-toolbar overhaul**: new shared `message-hover.ts` helper replaces old per-bubble synthetic-mouseover logic; reflects dashboard's move to a single delegated `MessageHoverToolbar`.
- **Readiness & flake fixes**: swap `networkidle` for `domcontentloaded` in baseline, add scroll-into-view before visibility checks, link-dialog Apply now waits for href commit, native-setter for controlled inputs, un-quarantines one input-box scenario.
- **TypeScript migration**: `build-summary-report` fully typed; CI script updated accordingly.
- **Quarantine opt-in**: `INCLUDE_QUARANTINE=true` env flag to re-run known-flaky scenarios on demand.
