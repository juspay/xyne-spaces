# XYNE-63166 Performance and Load Testing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a CI-neutral k6 performance framework for Xyne messaging that runs locally and from parameterized Jenkins, exports HTML/JSON reports, and streams metrics to VictoriaMetrics/Grafana.

**Architecture:** A Node launcher validates safe environment/profile/scenario inputs and executes a pinned k6 Docker image. Native k6 modules own workload profiles and messaging behavior; Jenkins and future GitHub Actions are thin adapters around the same root command.

**Tech Stack:** Node.js 22, native `node:test`, Grafana k6 2.2.0, Docker, Prometheus Remote Write, VictoriaMetrics, Grafana provisioning, Husky, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-10-xyne-63166-performance-testing-design.md`

## Global Constraints

- Keep existing Gauge + Playwright tests in `tools/xyne-automation/` unchanged.
- Do not add InfluxDB, Grafana Cloud, an npm k6 runtime package, or production load execution.
- Accept only `sandbox` and `preprod`; explicitly reject `production`.
- Use the pinned image `grafana/k6:2.2.0` for CI-compatible execution.
- Never commit or print tokens, session IDs, test-user data, generated reports, or raw metrics.
- Performance thresholds remain report-only for 3–5 baseline runs; readiness/auth/scenario correctness may fail immediately.
- Preserve the existing untracked `tools/xyne-automation/changelog.csv`.

---

## File map

| Path | Responsibility |
| --- | --- |
| `performance/config/catalog.mjs` | Safe scenario/profile/environment catalog and override caps. |
| `performance/scripts/run.mjs` | CLI parsing, validation, report directory, Docker invocation, exit classification. |
| `performance/tests/catalog.test.mjs` | Unit tests for catalog selection and safe override validation. |
| `performance/tests/run.test.mjs` | Unit tests for portable launcher argument/env construction. |
| `performance/k6/profiles.js` | k6 executor definitions and provisional thresholds. |
| `performance/k6/lib/config.js` | Required k6 environment parsing and auth headers. |
| `performance/k6/lib/checks.js` | Tagged request checks and custom failure metrics. |
| `performance/k6/lib/data.js` | Per-VU credential/fixture loading and selection. |
| `performance/k6/lib/report.js` | JSON summary and run metadata output. |
| `performance/k6/scenarios/smoke.js` | Public readiness and authenticated validation scenario. |
| `performance/k6/scenarios/messaging.js` | Text-only message-send performance scenario. |
| `performance/test-data/users.example.json` | Non-secret fixture schema example. |
| `performance/jenkins/performance-stage.groovy` | Copy-ready parameterized Jenkins stage example. |
| `docker/grafana/provisioning/dashboards/xyne-k6-performance.json` | Provisioned k6/VictoriaMetrics dashboard. |
| `.gitignore` | Ignore generated reports and private test data. |
| `.husky/pre-commit` | Fast validation for performance-only changes. |
| `package.json` | Root performance commands. |
| `performance/README.md` | Local, Jenkins, credentials, result, and troubleshooting guide. |

---

### Task 1: Safe configuration catalog

**Files:**
- Create: `performance/config/catalog.mjs`
- Create: `performance/tests/catalog.test.mjs`

**Interfaces:**
- Produces: `resolveRunConfig(input: RunInput): RunConfig`
- Produces: `PROFILES`, `ENVIRONMENTS`, `SCENARIOS`, `K6_IMAGE`
- Consumes: no earlier task interfaces

- [ ] **Step 1: Write failing catalog tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveRunConfig } from '../config/catalog.mjs';

test('defaults to safe smoke execution', () => {
  assert.deepEqual(resolveRunConfig({}), {
    environment: 'sandbox', profile: 'smoke', scenario: 'smoke',
    vusOverride: undefined, durationOverride: undefined,
  });
});

test('rejects production', () => {
  assert.throws(() => resolveRunConfig({ environment: 'production' }), /not allowed/);
});

test('rejects overrides above preprod cap', () => {
  assert.throws(
    () => resolveRunConfig({ environment: 'preprod', profile: 'load', scenario: 'messaging', vusOverride: '501' }),
    /maximum.*500/i,
  );
});
```

- [ ] **Step 2: Run the tests and verify missing-module failure**

Run: `node --test performance/tests/catalog.test.mjs`
Expected: FAIL because `performance/config/catalog.mjs` does not exist.

- [ ] **Step 3: Implement the validated catalog**

```js
export const K6_IMAGE = 'grafana/k6:2.2.0';
export const ENVIRONMENTS = { sandbox: { maxVus: 50 }, preprod: { maxVus: 500 } };
export const PROFILES = new Set(['smoke', 'release', 'load', 'stress', 'soak']);
export const SCENARIOS = new Set(['smoke', 'messaging']);

export function resolveRunConfig(input = {}) {
  const environment = input.environment ?? 'sandbox';
  const profile = input.profile ?? 'smoke';
  const scenario = input.scenario ?? (profile === 'smoke' ? 'smoke' : 'messaging');
  if (!ENVIRONMENTS[environment]) throw new Error(`Environment ${environment} is not allowed`);
  if (!PROFILES.has(profile)) throw new Error(`Unknown profile: ${profile}`);
  if (!SCENARIOS.has(scenario)) throw new Error(`Unknown scenario: ${scenario}`);
  const vusOverride = parseOptionalPositiveInteger(input.vusOverride, 'VUs');
  if (vusOverride && vusOverride > ENVIRONMENTS[environment].maxVus) {
    throw new Error(`VUs exceed maximum ${ENVIRONMENTS[environment].maxVus} for ${environment}`);
  }
  const durationOverride = parseOptionalDuration(input.durationOverride);
  return { environment, profile, scenario, vusOverride, durationOverride };
}
```

- [ ] **Step 4: Add complete validation cases and run tests**

Cover unknown profile/scenario, zero/negative/non-numeric VUs, invalid duration syntax, and valid `30s`, `15m`, `2h` durations.

Run: `node --test performance/tests/catalog.test.mjs`
Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add performance/config/catalog.mjs performance/tests/catalog.test.mjs
git commit -m "test: XYNE-63166 add safe performance run catalog"
```

### Task 2: Portable Docker launcher

**Files:**
- Create: `performance/scripts/run.mjs`
- Create: `performance/tests/run.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: `resolveRunConfig()` and `K6_IMAGE` from Task 1
- Produces: `parseCliArgs(argv)`, `buildDockerInvocation(config, runtime)`, `main()`

- [ ] **Step 1: Write failing launcher tests**

```js
test('builds a pinned, read-only k6 invocation', () => {
  const result = buildDockerInvocation(
    { environment: 'sandbox', profile: 'smoke', scenario: 'smoke' },
    { root: '/repo', runId: 'run-1', baseUrl: 'https://sandbox.example', token: 'secret' },
  );
  assert.equal(result.command, 'docker');
  assert.ok(result.args.includes('grafana/k6:2.2.0'));
  assert.ok(result.args.includes('/work/performance/k6/scenarios/smoke.js'));
  assert.equal(result.safeDisplay.includes('secret'), false);
});
```

Add tests that production is rejected, messaging requires a token/workspace/fixture file, Remote Write is optional, and generated paths remain under `performance/reports/<run-id>`.

- [ ] **Step 2: Verify tests fail before implementation**

Run: `node --test performance/tests/run.test.mjs`
Expected: FAIL because the launcher does not exist.

- [ ] **Step 3: Implement argument parsing and command construction**

The launcher accepts only:

```text
--environment sandbox|preprod
--profile smoke|release|load|stress|soak
--scenario smoke|messaging
--vus <bounded positive integer>
--duration <positive k6 duration>
--dry-run
```

It reads secrets from `PERF_BASE_URL`, `PERF_TEST_TOKEN`, `PERF_WORKSPACE_ID`, and `PERF_USERS_FILE`, never CLI arguments. It creates `performance/reports/<run-id>` and mounts the repository read-only plus that report directory read/write.

- [ ] **Step 4: Implement process execution and exit preservation**

Use `spawnSync('docker', args, { stdio: 'inherit', env })`. Return Docker/k6's exit code. Catch missing Docker and invalid configuration with an `ENVIRONMENT_FAILURE` message that contains no secret values.

- [ ] **Step 5: Add root commands**

```json
"perf:validate": "node --test performance/tests/*.test.mjs",
"perf:run": "node performance/scripts/run.mjs",
"perf:smoke": "node performance/scripts/run.mjs --profile smoke --scenario smoke"
```

- [ ] **Step 6: Run launcher tests and safe dry-run**

Run: `pnpm perf:validate`
Expected: PASS.

Run: `PERF_BASE_URL=https://example.invalid pnpm perf:run -- --dry-run`
Expected: prints a redacted Docker invocation and exits 0 without network traffic.

- [ ] **Step 7: Commit**

```bash
git add performance/scripts/run.mjs performance/tests/run.test.mjs package.json
git commit -m "feat: XYNE-63166 add portable k6 launcher"
```

### Task 3: k6 profiles, config, checks, and smoke scenario

**Files:**
- Create: `performance/k6/profiles.js`
- Create: `performance/k6/lib/config.js`
- Create: `performance/k6/lib/checks.js`
- Create: `performance/k6/lib/report.js`
- Create: `performance/k6/scenarios/smoke.js`

**Interfaces:**
- Produces: `getProfile(name)`, `getRuntimeConfig()`, `checkResponse()`, `handleSummary()`
- Consumes: environment variables injected by Task 2

- [ ] **Step 1: Add a launcher validation test for every profile/scenario combination**

Assert that `smoke/smoke`, `release/messaging`, `load/messaging`, `stress/messaging`, and `soak/messaging` point to existing entry files and never select production.

- [ ] **Step 2: Run it to expose missing k6 files**

Run: `pnpm perf:validate`
Expected: FAIL with the first missing entry file.

- [ ] **Step 3: Implement version-controlled profiles**

Define smoke as a few iterations; release as a gradual 10–15 minute ramp; load as expected-load steady state; stress as a controlled ramp; soak as a long low/normal load. Use `PERF_VUS_OVERRIDE` and `PERF_DURATION_OVERRIDE` only after launcher validation.

Set correctness thresholds to abort/fail immediately and tag performance thresholds so baseline policy can keep them non-blocking until enabled with `PERF_ENFORCE_THRESHOLDS=true`.

- [ ] **Step 4: Implement runtime validation and redaction-safe checks**

`getRuntimeConfig()` requires `PERF_BASE_URL`, removes a trailing slash, reads optional bearer/workspace headers, and never logs their values. `checkResponse()` tags operation-specific checks and increments a custom `Rate` for correctness failures.

- [ ] **Step 5: Implement smoke scenario and reports**

The smoke flow calls `GET /api/health/readiness`, checks status 200 and a healthy response, and performs one authenticated operation only when a token is provided. `handleSummary()` writes `summary.json` and `metadata.json` into `K6_REPORT_DIR`; HTML comes from k6's built-in web-dashboard export.

- [ ] **Step 6: Validate module loading**

Run: `pnpm perf:validate`
Expected: PASS.

When Docker is available, run: `PERF_BASE_URL=http://host.docker.internal:3001 pnpm perf:smoke`
Expected: the target-dependent result plus HTML/JSON artifacts; no secrets in output.

- [ ] **Step 7: Commit**

```bash
git add performance/k6 performance/tests
git commit -m "feat: XYNE-63166 add k6 smoke framework"
```

### Task 4: Per-VU fixtures and messaging scenario

**Files:**
- Create: `performance/k6/lib/data.js`
- Create: `performance/k6/scenarios/messaging.js`
- Create: `performance/test-data/users.example.json`
- Create: `performance/test-data/README.md`
- Modify: `performance/tests/run.test.mjs`

**Interfaces:**
- Produces: `loadUsers(path)`, `userForVu(users, vuId)` in k6
- Consumes: launcher-provided `PERF_USERS_FILE`, message endpoint auth/runtime configuration, profiles

- [ ] **Step 1: Write failing fixture-contract tests in the launcher suite**

Assert that messaging rejects a missing file, malformed JSON, empty users, missing `token`, `workspaceId`, or `conversationId`, and that fixture contents never appear in `safeDisplay`.

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test performance/tests/run.test.mjs`
Expected: FAIL until fixture validation is implemented.

- [ ] **Step 3: Implement fixture validation and safe example**

Use this committed schema with fake values only:

```json
{
  "users": [
    {
      "userId": "example-user-id",
      "token": "replace-at-runtime",
      "workspaceId": "example-workspace-id",
      "conversationId": "example-conversation-id"
    }
  ]
}
```

The runner validates the actual runtime file, mounts it read-only at `/perf-secrets/users.json`, and passes only that container path to k6.

- [ ] **Step 4: Implement deterministic per-VU selection**

Select `users[(__VU - 1) % users.length]`, require all four fields, and construct bearer plus `x-workspace-id` headers without logging them.

- [ ] **Step 5: Implement text-only message sends**

POST JSON `{ content: `PERF-${runId}-${__VU}-${__ITER}`, msgType: 'USER' }` to `/api/conversations/<id>/messages`. Tag the request `operation=message_send`, require status 201 and `messageId`, and apply think time from the profile.

- [ ] **Step 6: Run validation and a dry run**

Run: `pnpm perf:validate`
Expected: PASS.

Run: `PERF_BASE_URL=https://example.invalid PERF_USERS_FILE=performance/test-data/users.example.json pnpm perf:run -- --profile release --scenario messaging --dry-run`
Expected: valid redacted invocation; no token printed.

- [ ] **Step 7: Commit**

```bash
git add performance/k6 performance/test-data performance/tests
git commit -m "feat: XYNE-63166 add messaging load scenario"
```

### Task 5: VictoriaMetrics and Grafana integration

**Files:**
- Create: `docker/grafana/provisioning/dashboards/xyne-k6-performance.json`
- Modify: `performance/scripts/run.mjs`
- Modify: `performance/tests/run.test.mjs`

**Interfaces:**
- Consumes: optional `PERF_PROMETHEUS_RW_URL`, `PERF_PROMETHEUS_RW_USERNAME`, `PERF_PROMETHEUS_RW_PASSWORD`
- Produces: labelled `k6_*` series and a provisioned dashboard filtered by `test_run_id`

- [ ] **Step 1: Write failing Remote Write construction tests**

Assert that no `-o experimental-prometheus-rw` argument exists without an endpoint; with an endpoint it exists and sets `K6_PROMETHEUS_RW_SERVER_URL`, p95/p99 trend stats, and run tags. Assert credentials are never in `safeDisplay`.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm perf:validate`
Expected: FAIL until Remote Write construction is implemented.

- [ ] **Step 3: Implement optional Remote Write**

Pass endpoint/auth through container environment variables and add `-o experimental-prometheus-rw`. Add run labels through `K6_TAGS=test_run_id=...,release_version=...,environment=...,profile=...,scenario=...`.

- [ ] **Step 4: Add provisioned dashboard JSON**

Use the existing Prometheus datasource UID and panels for VUs, request rate, failures, p95/p99, message-send latency, checks, and data volume. Add variables for `test_run_id`, environment, profile, and scenario.

- [ ] **Step 5: Validate JSON and tests**

Run: `node -e "JSON.parse(require('node:fs').readFileSync('docker/grafana/provisioning/dashboards/xyne-k6-performance.json'))"`
Expected: exit 0.

Run: `pnpm perf:validate`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add docker/grafana/provisioning/dashboards/xyne-k6-performance.json performance
git commit -m "feat: XYNE-63166 add k6 Grafana observability"
```

### Task 6: Reports, ignore rules, and operator documentation

**Files:**
- Create: `performance/README.md`
- Modify: `.gitignore`
- Modify: `performance/scripts/run.mjs`
- Modify: `performance/tests/run.test.mjs`

**Interfaces:**
- Consumes: report outputs from Tasks 2–5
- Produces: documented local/CI command and predictable artifact directory

- [ ] **Step 1: Write a failing path-safety test**

Assert that a hostile release value such as `../../secret` is rejected and that all report output resolves inside `<repo>/performance/reports`.

- [ ] **Step 2: Run it and verify failure**

Run: `pnpm perf:validate`
Expected: FAIL until metadata/run-ID validation is complete.

- [ ] **Step 3: Add report ignore rules**

```gitignore
/performance/reports/*
!/performance/reports/.gitkeep
/performance/test-data/users.json
```

- [ ] **Step 4: Complete report metadata and README**

Document prerequisites, fixture creation, local smoke/messaging commands, profiles, environment variables, Docker network behavior, VictoriaMetrics, Grafana, report paths, result classifications, secret policy, Jenkins operation, and troubleshooting.

- [ ] **Step 5: Verify docs and tests**

Run: `pnpm perf:validate`
Expected: PASS.

Run: `git check-ignore performance/test-data/users.json performance/reports/test/report.html`
Expected: both paths are ignored.

- [ ] **Step 6: Commit**

```bash
git add .gitignore performance
git commit -m "docs: XYNE-63166 document performance test operation"
```

### Task 7: Repository hook integration

**Files:**
- Modify: `.husky/pre-commit`
- Modify: `CONTRIBUTING.md`

**Interfaces:**
- Consumes: root `perf:validate` command
- Produces: scoped pre-commit validation for `performance/**` and k6 dashboard JSON

- [ ] **Step 1: Add a shell-level assertion for path detection**

Extract staged path classification to variables already used by the hook and verify by inspection/test command that `performance/k6/scenarios/messaging.js` and `docker/grafana/provisioning/dashboards/xyne-k6-performance.json` set `PERFORMANCE_CHANGED`.

- [ ] **Step 2: Modify hook logic**

Add:

```sh
PERFORMANCE_CHANGED=$(echo "$CHANGED_FILES" | grep -E '^(performance/|docker/grafana/provisioning/dashboards/xyne-k6-performance\.json$)' || true)
```

When non-empty, run `pnpm run perf:validate`. Add it to the fallback condition so performance-only commits do not run unrelated dashboard lint. Do not run traffic from the hook.

- [ ] **Step 3: Update contribution documentation**

Add `performance/**` → `pnpm perf:validate` to the hook table and state that deployed load tests are never pre-commit tasks.

- [ ] **Step 4: Verify shell syntax and framework tests**

Run: `sh -n .husky/pre-commit`
Expected: exit 0.

Run: `pnpm perf:validate`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add .husky/pre-commit CONTRIBUTING.md
git commit -m "chore: XYNE-63166 validate performance test changes"
```

### Task 8: Parameterized Jenkins adapter example

**Files:**
- Create: `performance/jenkins/performance-stage.groovy`
- Modify: `performance/README.md`

**Interfaces:**
- Consumes: `pnpm perf:run`, Jenkins credentials, deployment readiness
- Produces: copy-ready Jenkins parameters/stage/post-artifact logic

- [ ] **Step 1: Write the adapter with exact parameters**

Define `RUN_PERFORMANCE_TESTS`, `PERF_PROFILE`, `PERF_ENVIRONMENT`, `PERF_SCENARIO`, `PERF_VUS_OVERRIDE`, and `PERF_DURATION_OVERRIDE`. Use `when { expression { params.RUN_PERFORMANCE_TESTS } }` after deployment/readiness.

- [ ] **Step 2: Bind credentials without parameters**

Use Jenkins credentials binding for the target URL/token/users file and optional Remote Write credentials. Invoke `pnpm perf:run` with non-secret selectors only.

- [ ] **Step 3: Archive evidence on every outcome**

In `post { always { ... } }`, archive `performance/reports/**/*` with `allowEmptyArchive: true`. Preserve the launcher exit status and publish a concise environment/profile/scenario/build summary.

- [ ] **Step 4: Document private-pipeline integration**

State explicitly that an owner must adapt credential IDs and insert the example into the operational private Jenkinsfile after deployment/readiness. The example is not automatically active merely because it exists in this repository.

- [ ] **Step 5: Review Groovy and run repository validation**

Run: `pnpm perf:validate`
Expected: PASS.

Review the stage for secret interpolation, archive-on-failure, safe choices, and disabled-by-default behavior.

- [ ] **Step 6: Commit**

```bash
git add performance/jenkins/performance-stage.groovy performance/README.md
git commit -m "ci: XYNE-63166 add parameterized Jenkins performance stage"
```

### Task 9: Final verification and handoff

**Files:**
- Modify only if verification finds a scoped defect

**Interfaces:**
- Consumes: all previous tasks
- Produces: verified implementation evidence and owner handoff

- [ ] **Step 1: Run all offline validations**

```bash
pnpm perf:validate
sh -n .husky/pre-commit
node -e "JSON.parse(require('node:fs').readFileSync('docker/grafana/provisioning/dashboards/xyne-k6-performance.json'))"
git diff --check
```

Expected: all commands exit 0.

- [ ] **Step 2: Verify safe dry runs**

```bash
PERF_BASE_URL=https://example.invalid pnpm perf:run -- --profile smoke --scenario smoke --dry-run
PERF_BASE_URL=https://example.invalid PERF_USERS_FILE=performance/test-data/users.example.json pnpm perf:run -- --profile release --scenario messaging --dry-run
```

Expected: both exit 0, show the pinned image and correct entrypoint, and reveal no token.

- [ ] **Step 3: Verify prohibited targets and unsafe values**

Run production, unknown profile, excessive VU, invalid duration, path traversal, and missing messaging fixture cases.
Expected: each exits non-zero before Docker/network execution with a specific non-secret validation message.

- [ ] **Step 4: Run target-dependent checks when infrastructure is supplied**

Run smoke against sandbox, messaging against the resettable pre-production workspace, verify HTML/JSON artifacts, inspect labelled VictoriaMetrics series, and open the provisioned Grafana dashboard. Record any unavailable external prerequisite explicitly.

- [ ] **Step 5: Inspect final repository state**

Run: `git status --short` and `git diff main...HEAD --stat`
Expected: only XYNE-63166 files plus the pre-existing untracked changelog; no reports or secrets.

- [ ] **Step 6: Commit any verification-only corrections**

```bash
git add performance .husky/pre-commit CONTRIBUTING.md package.json .gitignore docker/grafana/provisioning/dashboards/xyne-k6-performance.json
git commit -m "fix: XYNE-63166 correct performance framework validation"
```
