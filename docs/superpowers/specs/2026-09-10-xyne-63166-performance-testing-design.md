# XYNE-63166 Performance and Load Testing Design

**Status:** Approved architecture; implementation pending final spec review  
**Current CI:** Jenkins  
**Future CI:** GitHub Actions  
**Primary tool:** Grafana k6 OSS, initially pinned to `grafana/k6:2.2.0`  
**Initial target:** Pre-production real-time messaging and Zero-sync pipeline

## 1. Objective

Add a repository-owned performance-testing framework that:

- runs locally, in Jenkins now, and in GitHub Actions later through the same command;
- can be enabled or disabled as a parameterized post-deployment stage;
- tests the real-time messaging and Zero-sync pipeline first;
- produces threshold-based pass/fail results plus shareable HTML and JSON reports;
- streams k6 metrics into Xyne's existing VictoriaMetrics/Grafana stack; and
- does not add InfluxDB, duplicate the existing Gauge/Playwright framework, or run routine load against production.

## 2. Scope

### Included in the first implementation

1. A root-level `performance/` module with reusable k6 code.
2. Version-controlled workload profiles: smoke, release, load, stress, and soak.
3. A steady-state text-message scenario covering the message POST and required authenticated read/sync activity.
4. A portable local/CI runner with environment and profile validation.
5. Self-contained HTML and machine-readable JSON reports.
6. Prometheus Remote Write export to VictoriaMetrics.
7. A provisioned Grafana dashboard for k6 and relevant application signals.
8. A parameterized Jenkins stage after pre-production deployment and readiness.
9. A dedicated pre-commit validation path for `performance/` changes.
10. Documentation for local execution, test-data preparation, CI operation, and result interpretation.

### Deferred

- Browser load through Playwright or k6 browser.
- Distributed k6 execution or Grafana Cloud k6.
- Routine production load, stress, or soak testing.
- Attachment, AI/LLM, Gmail, Microsoft, or Slack load scenarios.
- Automatic migration to GitHub Actions; the portable interface is defined now, and the thin adapter is added when CI migration begins.
- Permanent blocking SLO values before 3–5 stable baseline runs.

## 3. Architecture decision

Use a **repo-owned, CI-neutral framework with thin pipeline adapters**.

```text
Existing Gauge + Playwright
  validates functional user journeys
                    |
                    v
performance/ portable k6 runner
  scenario + profile + environment + test data
       |                         |
       |                         +--> HTML + JSON CI artifacts
       v
Prometheus Remote Write
       v
VictoriaMetrics <--- application OpenTelemetry metrics
       |
       v
Grafana dashboard

Jenkins now -----------------> portable runner
GitHub Actions later --------> same portable runner
```

Jenkins contains only parameters, credentials binding, stage conditions, runner invocation, and artifact publication. Workload logic and thresholds do not live in the Jenkinsfile. This boundary makes the future GitHub Actions migration an adapter change rather than a framework rewrite.

## 4. Why the Instagram example is rearranged

The screenshots correctly separate functional testing, load generation, metric storage, visualization, and reporting. Xyne should adopt those responsibilities but map them onto existing infrastructure:

| Screenshot concept | Xyne implementation |
| --- | --- |
| Playwright project inside a new combined framework | Keep the current Gauge + Playwright suite under `tools/xyne-automation/`; do not duplicate or move it. |
| k6 scripts | Add the independent root-level `performance/` module. |
| InfluxDB for k6 metrics | Do not add it. Stream Prometheus-compatible k6 metrics to existing VictoriaMetrics. |
| Grafana dashboard | Provision an Xyne-specific dashboard beside current Grafana dashboards. |
| Reports directory committed with the framework | Generate reports into an ignored directory and archive them in CI; do not commit run output. |
| One combined CI flow | Use one portable runner invoked conditionally by Jenkins now and GitHub Actions later. |

## 5. Repository layout

```text
performance/
  README.md
  config/
    environments.js
    limits.js
  profiles/
    smoke.js
    release.js
    load.js
    stress.js
    soak.js
  scenarios/
    messaging.js
  lib/
    auth.js
    checks.js
    config.js
    data.js
    metrics.js
    report.js
  test-data/
    users.example.json
    README.md
  scripts/
    run.sh
  reports/
    .gitkeep

docker/grafana/provisioning/dashboards/
  xyne-k6-performance.json

docs/
  performance-load-testing-plan.md
  performance-testing-getting-started.md
  performance-testing-priority-decision.md
```

`performance/reports/*` is ignored except for `.gitkeep`. Tokens, session IDs, actual user data, generated HTML, JSON results, and raw metrics are never committed.

The first implementation uses native k6 JavaScript modules and does not add an npm runtime dependency. The CI runner uses a pinned k6 Docker image; local developers may use the same container or install the matching k6 version.

## 6. Responsibility boundaries

### Scenarios

A scenario describes **what a user does**, not how much load to generate. The initial `messaging.js` flow:

1. Select a virtual user's dedicated credential and conversation fixture.
2. Validate readiness once in setup.
3. Perform the authenticated baseline read/sync calls required by the real client flow.
4. Send a unique text-only message to a test conversation.
5. Verify the accepted response and capture message-send latency.
6. Pause using a configurable think time.
7. Repeat until the selected profile finishes.

Attachments, bot commands, AI generation, external-provider calls, and destructive cleanup are excluded from this scenario.

### Profiles

A profile describes **how much and how long** the scenario runs. The same messaging scenario is reused across profiles.

| Profile | Initial intent | Blocking policy |
| --- | --- | --- |
| `smoke` | 1–3 VUs, one or a few iterations, under 3 minutes | May block immediately on functional/check failure. |
| `release` | Gradual ramp and 10–15 minute steady-state run at agreed normal traffic | Report-only for 3–5 baseline runs; then eligible to block. |
| `load` | Expected peak traffic for 30–60 minutes | Manual, report-only initially. |
| `stress` | Controlled increase beyond expected peak to find degradation point | Manual and never an ordinary release gate. |
| `soak` | Low/normal load for several hours | Scheduled/manual and report-only. |

Exact VU/arrival-rate values remain version-controlled in profile files. Optional CI overrides are bounded by `config/limits.js`; the runner rejects values above the approved environment cap.

### Environment configuration

`config/environments.js` accepts only `sandbox` and `preprod`. It maps a logical environment name to non-secret configuration. Base URLs, credentials, and VictoriaMetrics authentication come from runtime environment variables or CI credentials.

The runner rejects `production`. A future production synthetic-check design must be a separately approved change and must not reuse load/stress profiles.

### Reports

Every run produces:

- a self-contained HTML k6 dashboard report;
- a machine-readable JSON summary;
- console output with threshold results; and
- metadata containing scenario, profile, environment, release version/commit, run ID, and UTC start/end time.

Reports are written under `performance/reports/<run-id>/` locally and archived by Jenkins. The CI artifact retention period follows the existing release evidence policy; if none exists, retain performance artifacts for 30 days.

## 7. Test data and authentication

Performance tests use a dedicated, resettable pre-production workspace. Each VU uses an assigned test identity rather than sharing one user/token across all VUs.

The committed `users.example.json` contains schema-only placeholder data. The real credential file is generated during the job into its temporary workspace and removed with workspace cleanup. It must not be printed, archived, passed as a build parameter, or sent to Grafana.

Existing `apps/backend/scripts/generate-load-test-tokens.ts` may be reused only after confirming that repeated credentials model the chosen scenario correctly. The first messaging load model requires multiple identities, so the final seed/token step must provide unique user/session entries when the backend session semantics require them.

Test data rules:

- conversations and channels belong only to the performance workspace;
- created messages include a `PERF-<run-id>` marker;
- the workspace is reset or reseeded before a release/load run;
- cleanup targets are resolved from the dedicated workspace ID, never from a broad environment or pattern; and
- provider credentials and customer-derived message content are prohibited.

## 8. Metrics and Grafana

k6 sends granular time-series metrics using Prometheus Remote Write to VictoriaMetrics. The same run generates local HTML/JSON reports even when metric export is unavailable.

Required run labels:

- `test_run_id`;
- `release_version`;
- `environment`;
- `profile`;
- `scenario`; and
- endpoint/operation name.

The Grafana dashboard combines client-side k6 results with application-side signals in the same time window.

### k6 panels

- active VUs or arrival rate;
- requests per second;
- request duration p50/p90/p95/p99;
- request/check failure rate;
- message-send latency;
- data sent/received; and
- thresholds by operation.

### Application panels

- message and Zero route rate/errors/p95/p99;
- Zero active clients, hydration time, WebSocket errors, serving lag, and replication lag;
- Node CPU, memory, and event-loop indicators;
- PostgreSQL connections/query latency/CPU/IO when exported;
- Redis latency/operations/memory; and
- Bull queue depth, oldest-job age, and drain/recovery behaviour.

If PostgreSQL or Redis telemetry remains unavailable, the report explicitly labels root-cause analysis as incomplete rather than inferring a definitive bottleneck.

## 9. Threshold policy

Thresholds are tagged per operation; a global average is not a release criterion.

Initial collection targets:

| Signal | Provisional guardrail |
| --- | --- |
| Readiness | 100% success |
| Authenticated checks | At least 99% success |
| HTTP request failures | Below 1% |
| Unhandled HTTP 5xx | Below 0.5% |
| Text message-send p95 | Below 300 ms at the agreed normal channel size |
| Socket delivery lag p95, once instrumented | Below 500 ms |
| Zero serving lag | Below 10 seconds in steady state and recovers after load stops |
| Queue depth | No sustained upward drift; returns toward baseline after traffic stops |

For the first 3–5 stable release runs, only readiness, authentication, and scenario correctness may fail the build; performance thresholds are collected and reported. After baseline approval, the release profile's agreed thresholds become blocking. Load, stress, and soak results remain report/review inputs unless management separately changes the policy.

## 10. Portable runner contract

The repository exposes one conceptual interface:

```text
pnpm perf:run --profile <profile> --environment <environment> --scenario <scenario>
```

The runner:

1. validates the profile, environment, scenario, required secrets, and override caps;
2. creates a unique report directory and run ID;
3. verifies target readiness;
4. starts the pinned k6 image with the selected modules;
5. enables HTML export and JSON summary generation;
6. enables Prometheus Remote Write when its endpoint is configured;
7. preserves the k6 exit code;
8. prints the artifact paths and Grafana run URL; and
9. returns non-zero on a blocking threshold/check or invalid configuration.

A metrics-export failure does not hide the load-test result. It marks the run `PASS_WITH_OBSERVABILITY_FAILURE` when functional/performance gates pass, uploads local reports, and requires release-owner review. Missing HTML/JSON output or invalid credentials is `INFRASTRUCTURE_ERROR`, not a product performance failure.

## 11. Jenkins integration

The current Jenkins build adds these parameters:

| Parameter | Type | Default | Allowed values/purpose |
| --- | --- | --- | --- |
| `RUN_PERFORMANCE_TESTS` | Boolean | `false` | Enables the stage. |
| `PERF_PROFILE` | Choice | `smoke` | `smoke`, `release`, `load`, `stress`, `soak`. |
| `PERF_ENVIRONMENT` | Choice | `sandbox` | `sandbox`, `preprod`. |
| `PERF_SCENARIO` | Choice | `messaging` | Version-controlled scenario name. |
| `PERF_VUS_OVERRIDE` | String | empty | Optional numeric override checked against environment caps. |
| `PERF_DURATION_OVERRIDE` | String | empty | Optional duration override checked against environment caps. |

The stage runs only after the selected target has been deployed and `/api/health/readiness` succeeds:

```text
Build and verify artifact
  -> deploy selected environment
  -> readiness
  -> RUN_PERFORMANCE_TESTS?
       false -> mark stage skipped
       true  -> bind protected credentials
              -> run portable command
              -> archive reports regardless of outcome
              -> publish summary
              -> apply current blocking policy
  -> release decision/promotion
```

Jenkins must use credentials binding for base URL/token and VictoriaMetrics credentials. Secret values are masked and never accepted through ordinary string parameters. Artifact publication runs in an `always`/equivalent post condition.

The current public checkout does not contain the operational Jenkinsfile. Therefore, implementation in this repository can complete the portable runner, tests, reports, dashboard, documentation, and example Jenkins stage. Wiring the stage into the real release pipeline requires access to the private Jenkins pipeline source or coordination with its owner; it must not be guessed from the GitHub Actions files.

## 12. GitHub Actions migration contract

The future workflow uses `workflow_dispatch` Boolean/choice inputs equivalent to the Jenkins parameters. It checks out the selected release revision, binds GitHub environment secrets, invokes the same `pnpm perf:run` command, and uploads the same report directory.

The migration must not rewrite scenarios, profiles, thresholds, environment rules, report generation, or Grafana dashboards. Only the pipeline adapter and secret-binding syntax change.

## 13. Repository hooks and validation

The current hooks require these changes and behaviours:

1. `.husky/pre-push` already accepts `feature/XYNE-63166-performance-load-testing`; no change is required.
2. `.husky/pre-commit` gains `PERFORMANCE_CHANGED` detection for paths under `performance/` and relevant Grafana dashboard definitions.
3. When performance files change, pre-commit runs fast static/framework validation only: script formatting, configuration validation, prohibited-secret scan, and a k6 script-load/archive validation when k6/Docker is available.
4. Pre-commit never runs smoke/load/stress/soak traffic against a deployed environment.
5. `.husky/post-commit` remains unchanged and does not automatically start performance tests.
6. `.husky/commit-msg` is currently disabled. Commit messages still follow the repository convention and include `XYNE-63166` voluntarily.

The pre-commit fallback is also corrected so a performance-only change does not trigger an unrelated dashboard lint merely because it is not one of the currently recognized path groups.

## 14. Failure classification

| Classification | Examples | CI/release treatment |
| --- | --- | --- |
| `PRODUCT_FAILURE` | Threshold breached, sustained 5xx, failed message/Zero checks | Follow profile blocking policy; publish evidence. |
| `TEST_FAILURE` | Invalid assertion, broken fixture selection, script exception | Fail stage; test owner fixes framework. |
| `ENVIRONMENT_FAILURE` | Target not ready, seed/reset failed, credentials expired | Fail stage as infrastructure; rerun only after owner validates the environment. |
| `OBSERVABILITY_FAILURE` | Remote Write/Grafana unavailable while local test completed | Preserve test result; mark for release-owner review and upload local artifacts. |
| `WAIVED_FAILURE` | Approved temporary exception | Record reason, approver, ticket, and expiry in release evidence. |

The runner and Jenkins summary must preserve this distinction. A failed environment must not be reported as an application capacity regression, and a performance failure must not be silently relabelled as infrastructure.

## 15. Verification strategy

Before enabling the Jenkins stage:

1. Validate configuration rejection for missing/invalid environment, profile, scenario, token, and unsafe overrides.
2. Run the smoke profile locally against a controlled test target.
3. Confirm no secret appears in console, JSON, HTML, or Grafana labels.
4. Confirm threshold failure returns non-zero and still produces reports.
5. Confirm Remote Write produces labelled k6 series in VictoriaMetrics.
6. Confirm Grafana filters a single run by `test_run_id`.
7. Confirm Jenkins archives artifacts on pass, product failure, and infrastructure failure.
8. Confirm `RUN_PERFORMANCE_TESTS=false` skips the stage without starting k6.
9. Run the release profile 3–5 times on an unchanged deployment to measure variance before enabling performance blocking.

## 16. Delivery sequence

1. Add framework skeleton, validation, profiles, and local smoke readiness scenario.
2. Add dedicated test-data contract and safe credential loading.
3. Implement the steady-state text-message scenario.
4. Add HTML/JSON reporting and run metadata.
5. Add VictoriaMetrics Remote Write and Grafana dashboard.
6. Add pre-commit performance validation.
7. Integrate the parameterized Jenkins stage.
8. Run report-only baselines and review variance.
9. Agree and enable blocking release thresholds.
10. Add reconnect, participant fan-out, mixed-ingest, search, and ticket scenarios in later scoped changes.

## 17. Acceptance criteria

The first implementation is accepted when:

- one command runs the messaging scenario locally and in Jenkins;
- Jenkins can enable/disable the stage and choose only safe profiles/environments;
- smoke and release profiles reuse the same scenario code;
- tests use dedicated non-production identities and resettable fixtures;
- HTML and JSON reports are produced and archived on success and failure;
- k6 metrics are queryable in VictoriaMetrics and visible in a provisioned Grafana dashboard;
- the stage reports a clear failure classification and honors the baseline-period blocking policy;
- performance-only commits receive relevant fast validation instead of unrelated dashboard lint; and
- the same runner contract is sufficient for a later GitHub Actions wrapper.
