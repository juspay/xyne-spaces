# Xyne Automation - AGENTS.md

## What this package is

- Gauge + Playwright TypeScript automation suite.
- BDD style, not story-heavy. Goal: reliable executable behavior checks.
- Tests under `tests/`, run through Gauge, not Playwright `test()` files.

## Core principles

- **Self-contained** - no scenario-order or leftover-state dependence.
- **Deterministic** - same setup, same result.
- **Parallel-safe** - safe beside other scenarios.
- **Simple, small, clean** - readable specs, small steps, reusable concepts.
- **Validation-friendly** - reuse validated literals, names, patterns.

## LLM agent guidelines

When writing or suggesting tests, follow these rules:

### Think parallel-first

Every scenario may run simultaneously with every other. Design accordingly:

- Never assume execution order between scenarios.
- Never read state written by another scenario.
- Never mutate shared resources (baseline fixture, shared users) expecting other scenarios see change.
- If two scenarios touch same entity, use separate instances or prove safe under concurrent access.

Before writing any test, ask: "Would this break if another scenario runs same time?" If yes, redesign.

### Use fixture data, not test-created data, for expected values

Tests derive expected values from fixtures and user catalog — not from data created during execution.

- **Right**: Store channel name from baseline fixture via `ensuring channel <channelAlias> exists in fixture for user <userAlias>`, verify against stored value.
- **Wrong**: Create channel with hardcoded name, assert that exact name appears. Couples assertion to creation step, breaks on retry (unique suffixes change).
- **Wrong**: Generate value in one step, pass through global state, assert in another — hides expected value, makes failures harder to diagnose.

Baseline fixture and user catalog = source of truth. Use `user:<alias>.<field.path>` interpolation for stored data. If test needs data not in fixtures, create through proper fixture/ensure flow, store it, reference stored version — never inline literals as both creation input and assertion target.

### Suggest fixture-based approaches to users

When user asks to write test needing pre-existing data (project, channel, membership, etc.):

1. Check if baseline fixture already provides what's needed.
2. If yes, suggest using baseline data instead of creating new entities.
3. If no, suggest extending fixture system or using ensure/store pattern — not ad-hoc creation with hardcoded values.
4. Explain why: parallel safety, retry resilience, single source of truth.

### Expected vs actual in assertions

- Expected value = what system should produce, derived from fixture/stored data.
- Actual value = what UI or API returned.
- Always make distinction clear in assertion steps. Use stored interpolation (`user:admin-1.projects.project-1.name`) for expected values, page/API queries for actual values.

## Package layout

- `config/` - runtime config from env.
- `lib/` - shared utilities (logger with `gaugeLogger` and `baselineLogger` exports).
- `scripts/run-gauge.ts` - Gauge runner wrapper.
- `scripts/validation/` - filename and literal validation.
- `tests/01_api/` - API scenarios.
- `tests/02_ui/` - UI scenarios.
- `tests/03_e2e/` - E2E scenarios.
- `tests/shared/` - shared steps, runtime store, browser manager, literal validators, report artifact snapshots, suite hooks.
- `fixtures/` - static automation fixtures: user catalog, fixture helpers, baseline fixture.
- `env/default/` - Gauge runtime properties.
- `reports/`, `.gauge/` - runtime artifacts, gitignored. Gauge runs create `reports/<9-char-commit-hash>-<sequence>/` folders with `html-report/`, `gauge.log`, `run-metadata.json`, and runner folders (`runner/<n>/` when Gauge exposes worker ids, otherwise `runner/pid-<pid>/`) containing `runner.log` plus `context.json` snapshots.

## Developer commands

```bash
# Run all tests
npm test

# Run by test area
npm run test:api      # tests/01_api only
npm run test:ui       # tests/02_ui only
npm run test:e2e      # tests/03_e2e only

# Run a single spec file directly via Gauge
npx gauge run tests/01_api/01_health/01_health.spec

# Run a single scenario by name
npx gauge run --tags "scenario-name" tests/path/to/file.spec

# Full validation (required for all non-doc code changes)
npm run validate      # biome ci + biome format check + filename validation + literal validation

# Individual validation steps
npm run check         # biome lint + assist
npm run check:fix     # biome lint + assist with auto-fix
npm run format        # biome format with auto-write
npm run format:check  # biome format check only
npm run validate:filename   # numbered folders/specs, no .js files
npm run validate:literals   # browser names, assertion hooks in step defs
```

`validate` chain: `biome ci` -> `biome format` -> `validate:filename` -> `validate:literals`. All four must pass.

## Execution rules

- Run smallest relevant test scope for changed area.
- Run full `npm run validate` for any non-doc code change.
- If change affects shared steps, validators, config, or runtime behavior, validation mandatory.

## BDD structure rules

- `.spec`: one behavior per scenario, minimal business-readable steps, explicit setup and assertion. Use scenario tables for small input variations (see `01_unauthenticated-redirect.spec` for table-driven example).
- `.cpt`: reusable multi-spec flows (login, browser boot, onboarding, project creation). Only create concept if improves readability, reuse, or consistency.
- Keep low-level selector choreography and giant end-to-end scripts out of both.

## Test implementation rules

- Each scenario must own its setup: open own browser session, ensure auth state, navigate from known starting point. Never assume previous scenario created needed state.
- Prefer existing wait/assert steps over ad hoc sleeps. Assert paths, visible text, response status, or stable UI state.
- Keep browser names unique per scenario intent. No shared mutable test data without isolation guarantees.
- One step = one action or one assertion. Compositions belong in `.cpt`, not giant `@Step` methods.

## Step definition rules

- One `export default class` per file with `@Step(...)` decorated methods.
- All step methods `public async` returning `Promise<void>`.
- Prefer shared step files for cross-cutting behavior.
- Keep step text stable. Changing text breaks specs/concepts.

### Step file structure

- Imports: `node:` built-ins first, then `gauge-ts`, then `@/` project modules.
- Group methods under section comment banners (SETUP, ACTION, ASSERTION, STATE).
- No constructor or lifecycle hooks in step classes — lifecycle managed by `hooks.steps.ts`.

### Step text conventions

- Actions: `opening ...`, `clicking ...`, `typing ...`, `sending ...`
- Preconditions: `ensuring ...`
- Assertions: `verifying ...`, `checking ...`
- State/teardown: `storing ...`, `closing ...`
- Parameters use `<camelCase>` placeholders.

### Step method pattern

- Call `assertValid*` guards at top before any work.
- Access browser/page/context through `testContext` singleton, not local state.
- Use `node:assert/strict` for result assertions.

When adding parameters, prefer existing validated names when meaning matches:

- `userAlias`
- `urlPath`
- `statusCode`
- `projectAlias`
- `channelAlias`
- `dmAlias`
- `messageAlias`

Reason: validators already inspect those names and enforce required assertion hooks.

## Stored text interpolation

Spec files and some step definitions use `user:<alias>.<field.path>` interpolation syntax to reference stored user data at runtime. `resolveStoredText` function in `browser.steps.ts` resolves these patterns.

Examples from spec files:
- `"user:admin-1.channels.channel-1.name"` - resolves to stored channel name
- `"user:user-1.email"` - resolves to stored user email
- `"user:user-1.name"` - resolves to stored user display name

Works because step methods like `typing`, `clicking on text` call `resolveStoredText()` before acting. Stored data comes from `testContext.storedUsers` map, populated during login and project/channel creation steps.

Message typing and verification use dedicated browser steps (`typing stored user <userAlias> dm/channel <dmAlias/channelAlias> message <messageAlias> in/visible in <selector>`) that internally resolve message text path. Sending and verifying messages composed in `.cpt` concepts using these generic browser steps — no domain-specific send or verify steps exist in `messaging.steps.ts`.

Available stored user fields: `alias`, `role`, `id`, `email`, `name`, `profilePictureUrl`, `projects.<projectAlias>.<name|code|description>`, `channels.<channelAlias>.<name|url|messages.<messageAlias>.text>`, `dms.<dmAlias>.<name|url|messages.<messageAlias>.text>`.

Baseline fixture fields available after `@BeforeScenario` rehydration; no explicit creation steps needed:
- `admin-1.projects.project-1`, `admin-1.channels.channel-1` — owner-side references
- `user-1.channels.channel-1` (with `messages.message-baseline`) — `user-1` is `channel-1` member
- `user-1.dms.dm-1` (with `url` and `messages.message-baseline`) — DM between `user-1` and `user-2`

## Test auth flow

Tests do **not** use real Google OAuth. Test auth flow:

1. Navigate to `/auth?email=<test-email>&setAsNewUser=<true|false>`
2. Click "Sign in with Google" button
3. Dashboard intercepts, hits `POST /test/auth/login` on backend
4. Response contains user object (`id`, `email`, `name`, `profilePictureUrl`)
5. User data stored in `testContext.storedUsers` for scenario

`setAsNewUser=true` creates fresh user; `setAsNewUser=false` logs in existing user. All test emails follow pattern `test-(user|admin)-email-<N>@xyne-test.local`.

`setAsNewUser` only controls onboarding flow: `true` may trigger onboarding steps, `false` skips them. Test auth endpoint always creates user on backend regardless — not a "create vs login" toggle.

### Multi-browser login

Concept `Logging in user <userAlias> on temp browser <browserAlias>` creates (or switches to) named browser session, logs user in, auto-switches back to default browser. Temp browsers exist for scenario duration, auto-released by `AfterScenario` along with default browser session. Browser pool `Browser` instances preserved; only contexts and pages released.

Example:
```
* Logging in user "user-2" on temp browser "dm-browser-2"
```
After this concept, active browser back to `default-browser-1`. Switch to temp browser later: `switching to temp browser "dm-browser-2"`. Return to main browser: `Switching to main browser` concept.

## Baseline fixture model

Baseline fixture = shared, read-only project and channel created once per Gauge run, reused across all scenarios and workers.

**What it is**

- One project (`project-1`) and one channel (`channel-1`), with `user-1` pre-added as `channel-1` member
- One DM (`dm-1`) between `user-1` and `user-2`, with one seed message (`message-baseline`) sent by `user-1`
- One seed message (`message-baseline`) sent by `admin-1` in `channel-1`
- Created during bootstrap in `run-gauge.ts` via `bootstrapBaselineFixture()` in `fixtures/baseline.ts` (admin-1 creates project/channel; user-1 creates DM)
- Three users created during bootstrap: `admin-1` (owner), `user-1` (channel/DM owner), `user-2` (DM partner)
- Shared across all scenarios; tests must NOT modify or delete these entities
- Bootstrap respects `config.headless` and `config.browser` — runs headless when `HEADLESS=true`
- `user-1` pre-added to `channel-1` during bootstrap (via add-people UI flow). Makes channel messaging tests self-sustained — `user-1` can navigate to `channel-1` without depending on other scenarios.

**Registry location**

`${XYNE_RUN_ARTIFACT_DIR}/baseline-fixtures.json` contains:
```json
{
  "runId": "<uuid>",
  "ownerUserAlias": "admin-1",
  "project": { "id", "name", "code", "description" },
  "channel": { "id", "name", "url?", "seedMessage": { "baseText", "text" } },
  "dm": { "id", "name", "url", "ownerAlias", "partnerAlias", "seedMessage": { "baseText", "text" } }
}
```

**Read-only rule**

Baseline project, channel, and DM = infrastructure. Tests needing mutations must create net-new channels/DMs via create flow. Baseline exists for stable references across scenarios (e.g., sending messages to known channel/DM, starting calls from known DM). Only exception: `user-1` is `channel-1` member (added during bootstrap) and `dm-1` participant. Tests for add-member or DM-creation flows should use `user-3`, `user-4`, or other catalog users — not `user-2`, since `user-2` already has a DM with `user-1`.

**Ensure vs Create semantics**

- `ensuring project <projectAlias> exists in fixture for user <userAlias>` — for baseline (`project-1`), reads from registry (fail-fast if missing). For non-baseline aliases, generates synthetic project data via `generating net-new project details`.
- `ensuring channel <channelAlias> exists in fixture for user <userAlias>` — for baseline (`channel-1`), reads from registry. For non-baseline aliases, generates unique channel names via `generating net-new channel details`.
- Only `Creating project <projectAlias> for user <userAlias>` concept performs actual UI creation for net-new projects.
- Only `Creating channel <channelAlias> for user <userAlias>` concept performs actual UI creation for net-new channels.

**Rehydration**

`@BeforeSuite` calls `loadBaselineFixtureIntoWorkerContext()` to inject baseline data into `testContext.persistentStoredUsers`. Each `@BeforeScenario`, `resetScenarioState()` clones persistent users into `storedUsers`. Makes `user:admin-1.projects.project-1.name`, `user:admin-1.channels.channel-1.name`, `user:user-1.channels.channel-1.messages.message-baseline.text`, and `user:user-1.dms.dm-1.url` available for interpolation in every scenario. `user-2` is created on the backend during bootstrap but not rehydrated into `storedUsers` — scenarios that need `user-2` data must log them in via `Logging in user "user-2" on temp browser ...` or `Ensuring user "user-2" exists`.

**Source**

All baseline logic in `fixtures/baseline.ts`: contract constants, registry read/write, bootstrap, rehydration. Bootstrap runs in parent process (`run-gauge.ts`) before Gauge workers start — no cross-worker locking needed.

**Negative-path toggle**

Set `XYNE_SKIP_BASELINE_BOOTSTRAP=true` to disable bootstrap for fail-fast verification scenarios.

## User catalog

`fixtures/user-catalog.json` defines available test users. Currently: `admin-1`, `admin-2`, `user-1` through `user-4`.

Use `getUserCatalogEntry(userAlias)` from `fixtures/user-catalog.ts` for catalog entries. Use `testContext.storedUsers.get(alias)` for runtime state (populated after login).

## Literal validation rules

Validation not optional. Lean into it.

### URL paths

- Paths validated as `urlPath` must start with `/`
- `/auth` paths only allow query params:
  - `email`
  - `setAsNewUser`

### Test emails

- Must match `test-(user|admin)-email-<N>@xyne-test.local`

### Browser names

- Must match `<name>-browser-<number>` (e.g. `auth-browser-1`). Enforced by `validate:literals`.

### User aliases

- Must match `admin-<number>` or `user-<number>`.

### Project aliases

- Must match `project-<alphanumeric-with-hyphens>`.

### Channel aliases

- Must match `channel-<alphanumeric-with-hyphens>`.

### DM aliases

- Must match `dm-<alphanumeric-with-hyphens>`.

### Message aliases

- Must match `message-<alphanumeric-with-hyphens>`.

### Required assertion hooks

If step definition uses these parameter names, method body must call matching validator:

- `userAlias` -> `assertValidUserAlias(userAlias)`
- `urlPath` -> `assertValidUrlPath(urlPath)`
- `statusCode` -> `assertValidStatusCode(statusCode)`
- `projectAlias` -> `assertValidProjectAlias(projectAlias)`
- `channelAlias` -> `assertValidChannelAlias(channelAlias)`
- `dmAlias` -> `assertValidDmAlias(dmAlias)`
- `messageAlias` -> `assertValidMessageAlias(messageAlias)`

No casual renaming. Reuse same literal names across scenarios and steps.

## Config and environment rules

- Read runtime values through `config/index.ts` whenever possible.
- Prefer `config.backend.baseUrl`, `config.dashboard.baseUrl`, `config.timeout`, `config.headless`, `config.browser`, `config.parallel`, etc.
- No direct `process.env` reads from random test files if config already models value.
- Maximize env usage through config layer, not scattered direct env access.

### Environment variables

Required:
- `TEST_ENV` - one of `local`, `local-test`, `test`, `sbx`, `prod`. No default; must be set.

Optional overrides:
- `BACKEND_URL` - overrides default backend URL for environment
- `DASHBOARD_URL` - overrides default dashboard URL for environment
- `TIMEOUT` - default: 30000ms
- `RETRIES` - default: 3
- `HEADLESS` - default: false for `local`, true for all others
- `BROWSER` - one of `chromium`, `chrome`, `firefox`, `webkit`. Default: `chrome`
- `ENABLE_BROWSER_CONSOLE_LOGS` - default: true for `test`/`local-test`, false otherwise
- `PARALLEL` - number of parallel Gauge workers. Default: 3 for `local`/`local-test`, 1 otherwise

If config doesn't expose something needed:

- First extend `config/index.ts`
- Update `.env.example` if new env var introduced
- If direct env access still seems necessary, confirm with user before spreading into test code

Note: `sbx` and `prod` environments currently exit early with "coming soon" message in `run-gauge.ts`.

### Internal environment variables (set by run-gauge.ts)

Set automatically by `scripts/run-gauge.ts` — do not set manually:

- `XYNE_RUN_ARTIFACT_DIR` - path to current run artifact directory (`reports/<hash>-<seq>/`)
- `XYNE_RUN_ID` - UUID for current run
- `XYNE_LOG_TO_STDOUT` - controls logger console output. `true` during bootstrap, `false` during Gauge workers (workers write to per-runner log files only)
- `XYNE_TEST_PROGRESS_FILE` - append-only scenario result events used by the parent runner to render aggregate progress across Gauge workers
- `gauge_reports_dir` - set to `${artifactDir}/html-report` so Gauge writes HTML report into artifact folder

## Shared runtime rules

- `tests/shared/runtime/test-context.ts` = single runtime store. Holds `activeSession`, `storedUsers`, `lastResponse`, `apiRequestContext`.
- Messages stored inside conversation context (`StoredConversation.messages`) under `StoredUser.dms` and `StoredUser.channels`. Each `StoredMessage` has `alias`, `baseText`, `text` (baseText with unique suffix). Prevents retry false positives — on retry, new suffix generated so old messages from previous run can't match verification step. Receiver verifies sender's stored message, both reference same unique text.
- `testContext.sessions` holds named browser sessions per scenario. `testContext.activeSessionName` tracks current session. Steps use `activePage` which delegates to active session.
- `switching to temp browser <name>` creates or switches to named browser session. `AfterScenario` calls `resetAllBrowserSessionsForReuse()` — keeps main browser process alive in pool, closes temp browsers. Only contexts and pages released.
- `tests/shared/support/browser-manager.ts` owns browser and API context lifecycle. Uses browser pool reusing browser instances across scenarios.
- Browser processes may reuse across scenarios, but each scenario must get fresh context/page and user-level state.
- `tests/shared/support/literal-validation.ts` exports assertion guards for validated parameter names.
- `fixtures/user-catalog.ts` owns test user catalog loaded from fixtures.
- `fixtures/fixture-helpers.ts` provides `buildRandomSuffix` and `getStoredUser` helpers.
- `fixtures/baseline.ts` owns full baseline fixture: contract constants, registry persistence, bootstrap, rehydration.
- `tests/shared/browser.steps.ts` defines shared step definitions for browser session management, navigation, interaction, assertions.
- `tests/shared/support/report-artifacts.ts` writes `context.json` snapshots per runner. Captures test context state (sessions, stored users, responses) at suite and scenario boundaries for debugging.
- `tests/shared/hooks.steps.ts` handles lifecycle: `BeforeSuite` (loads baseline), `BeforeScenario` (writes snapshot), `BeforeStep`/`AfterStep` (step timing), `AfterScenario` (snapshot, reset browser sessions, reset scenario state), `AfterSuite` (snapshot, close all browsers, dispose API context, close logger).

Reuse existing functions from these modules. No alternate hidden global state managers unless doing deliberate repo-wide refactor.

## Naming and file rules

Enforced by `scripts/validation/validate-filename.ts`:

- Test folders under `tests/` must start with numeric prefix (e.g. `01_`, `02_`)
- `.spec` files must start with numeric prefix
- `tests/shared/` and anything under it exempt from numbered-folder rule
- `.js`, `.cjs`, `.mjs` files not allowed anywhere; use `.ts`

## Import and code style rules

- Use `@/` path aliases. Relative imports (`./`, `../`) **blocked by Biome** as lint errors.
- Use `node:` protocol for built-ins (enforced: `useNodejsImportProtocol: error`).
- Keep strict TypeScript (`"strict": true`, `experimentalDecorators` and `emitDecoratorMetadata` enabled for Gauge decorators).
- No `any`, `@ts-ignore`, `@ts-expect-error`.
- `console` / `debugger` banned in normal source files (Biome `noConsole: error`, `noDebugger: error`).
- CLI scripts (`scripts/`, `lib/logger.ts`) use `/** biome-ignore-all lint/suspicious/noConsole: <reason> */` at file top to opt out.
- Biome import ordering: `node:` -> packages -> `@/config` -> `@/lib` -> `@/fixtures` -> `@/tests` -> relative (relative blocked, but ordered for assist).

## Gauge runtime facts

- `env/default/default.properties`:
  - `gauge_specs_dir = tests`
  - `screenshot_on_failure = true`
  - `enable_multithreading = false`
- `env/default/ts.properties`:
  - `STEP_IMPL_DIR = tests`
- `manifest.json`: Language `ts`, plugin `html-report`.
- Parallel execution orchestrated by `scripts/run-gauge.ts` via Gauge CLI flags (`-p -n <count>`), not Gauge multithreading.
- Sort order `--sort=alpha` — specs run alphabetically.

## Concept file map

| File | Concepts |
|---|---|
| `tests/03_e2e/browser.cpt` | `Using browser`, `Switching to main browser` |
| `tests/03_e2e/01_unauthenticated-redirect/unauthenticated-redirect.cpt` | `Unauthenticated user opening <path> should land on login` |
| `tests/03_e2e/02_auth/auth.cpt` | `Logging in as user <userAlias>`, `Logging in as user <userAlias> as a new user`, `Ensuring user <userAlias> is logged in`, `Ensuring user <userAlias> exists (relogin required)`, `Logging in user <userAlias> on temp browser <browserAlias>`, `Skipping user onboarding` |
| `tests/03_e2e/03_project/project.cpt` | `Creating project <projectAlias> for user <userAlias>` |
| `tests/03_e2e/04_channel/channel.cpt` | `Navigating to channel <channelAlias> for user <userAlias>`, `Creating channel <channelAlias> for user <userAlias>` |
| `tests/03_e2e/05_messaging/messaging.cpt` | `Creating DM with user <userAlias>`, `Creating group DM with users <userAlias1> and <userAlias2>`, `Sending stored message <messageAlias> in dm <dmAlias> for user <userAlias>`, `Verifying stored message ... in dm/channel ... is visible in current conversation`, `Sending stored message <messageAlias> in channel <channelAlias> for user <userAlias>`, `Navigating to chat`, `Opening DM from user <userAlias>` |

## Step definition file map

| File | Scope | Key steps |
|---|---|---|
| `tests/shared/browser.steps.ts` | Shared | Browser session, navigation, click/type interactions (including typing/verifying stored message text), assertions, onboarding skip, switching to main browser, switching to temp browser, using browser with viewport |
| `tests/shared/hooks.steps.ts` | Shared | `BeforeSuite` baseline load, `BeforeStep`/`AfterStep` timing, `AfterScenario` cleanup, `AfterSuite` teardown |
| `tests/shared/support/report-artifacts.ts` | Shared | Context snapshot writes at suite/scenario boundaries |
| `fixtures/baseline.ts` | Shared | Baseline contract, registry, bootstrap, rehydration |
| `tests/01_api/api-common.steps.ts` | API | API context setup, GET requests, response status/body assertions |
| `tests/03_e2e/e2e-common.steps.ts` | E2E | Ensure not logged in, verify redirect path (supports wildcard `/*` matching) |
| `tests/03_e2e/03_project/project.steps.ts` | E2E/Project | Login and store user, ensure/generate project and channel fixtures, capture created channel details |
| `tests/03_e2e/05_messaging/messaging.steps.ts` | E2E/Messaging | Generate message fixtures with unique suffix in DM and channel contexts; navigate to baseline DM via stored URL (`opening baseline DM for user <userAlias>`) |

## Change checklist

When adding or changing tests:

1. Put scenario in correct test area, self-contained and deterministic.
2. Reuse existing literal names, validators, concepts, shared steps.
3. Route env-dependent behavior through `config`.
4. Run targeted tests, then `npm run validate`.

Do not: add Playwright `test()` files, create giant concepts/steps, depend on scenario order or leftover state, bypass config or literal validation.

If change adds new shared modules, validation rules, config fields, or alters package layout, update this AGENTS.md. Keep updates concise, avoid restating existing rules.
