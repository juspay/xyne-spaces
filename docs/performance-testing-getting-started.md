# Performance Testing: Beginner Runbook

This guide explains how to operate the XYNE-63166 performance framework from zero experience. The
architecture and module priority are documented in
[the design](./superpowers/specs/2026-09-10-xyne-63166-performance-testing-design.md) and
[the priority decision](./performance-testing-priority-decision.md).

## 1. Understand the four moving parts

```text
Jenkins parameterized stage
          |
          v
pnpm perf:run -> pinned k6 container -> Xyne sandbox/preprod
          |                 |
          |                 +-> VictoriaMetrics -> Grafana live dashboard
          +-> HTML + JSON files -> Jenkins archived artifacts/release evidence
```

- **k6** simulates virtual users and applies checks/thresholds.
- **VictoriaMetrics** stores time-series results. Xyne already uses it, so no InfluxDB is added.
- **Grafana** shows load-generator and application metrics together.
- **Jenkins** selects the safe environment/profile, binds secrets, runs one repository command, and
  archives reports. Performance workload logic does not live in Jenkins.

Playwright/Gauge continues to answer “does the UI journey work?” k6 answers “does the API remain
correct and fast under concurrent traffic?” Do not use Playwright browsers as the main load source.

## 2. Learn these five terms

| Term | Simple meaning |
| --- | --- |
| Virtual user (VU) | One simulated user repeatedly performing the scenario. |
| Scenario | The user action, currently readiness or text-message send. |
| Profile | The traffic shape: smoke, release, load, stress, or soak. |
| p95 | 95 of 100 samples complete at or below this time. |
| Threshold | A rule that changes the command to pass or fail. |

## 3. One-time setup owned by the team

Before sending load, ask the platform/backend owners for:

1. Sandbox and pre-production base URLs reachable from the Jenkins agent.
2. A dedicated performance workspace that can be reset without touching customer data.
3. Several test identities, short-lived bearer tokens, and writable conversation IDs.
4. The safe workspace reset/seed command and its owner.
5. The VictoriaMetrics Remote Write URL and protected credentials.
6. Access to the **Xyne k6 Performance Testing** Grafana dashboard.
7. The release owner who records **Go**, **Investigate**, or **Approved waiver**.

These are deployment dependencies, not npm dependencies. Never solve a missing test identity by
using an employee or customer token.

## 4. First local learning run

From the repository root:

```bash
pnpm perf:validate
docker version
PERF_BASE_URL=https://sandbox.example.com \
PERF_RELEASE_VERSION=local-learning \
pnpm perf:smoke
```

Expected result: k6 calls `/api/health/readiness`, then writes `report.html`, `summary.json`, and
`metadata.json` into a timestamped folder under `performance/reports/`.

If this fails, do not add users. Check DNS/TLS, Docker networking, the URL, deployment readiness,
and whether the Jenkins/local machine is allowed to reach the environment.

## 5. Prepare the first messaging run

1. Copy `performance/test-data/users.example.json` to
   `performance/test-data/users.sandbox.json`.
2. Add dedicated identity records supplied by the environment owner.
3. Confirm every conversation belongs to the performance workspace.
4. Confirm how the workspace will be reset after generated `PERF-<run-id>` messages.
5. Keep the real JSON file untracked; the repository ignore rules protect it.

Run only five VUs for two steady minutes while learning. Start with `zero-query-transform`, the read-only
scenario covering the Zero query-transform step — it needs no workspace reset:

```bash
PERF_BASE_URL=https://sandbox.example.com \
PERF_RELEASE_VERSION=1.298.0 \
PERF_USERS_FILE=performance/test-data/users.sandbox.json \
pnpm perf:run -- --environment sandbox --profile release --scenario zero-query-transform --vus 5 --duration 2m
```

Read the console first, then open the HTML report. Verify request count, HTTP failures, check pass
rate, Zero query-transform p95, and whether the application remained ready.

`rest-messaging` is the same command with `--scenario rest-messaging` plus
`PERF_ALLOW_WRITE_SCENARIOS=true`, without which the runner refuses it. It writes a message row per
iteration, so reset the workspace afterward — and note step 4 above is still an open question, not
a solved one. The Zero endpoints are also rate limited per identity (300 requests / 60s), so the
runner refuses a `zero-query-transform` run whose fixture is too small; see
`performance/test-data/README.md` for the sizing table.

## 6. Jenkins release procedure

The performance stage belongs **after deployment and readiness**, not in compile/build jobs:

```text
build and test artifact
  -> deploy selected environment
  -> readiness succeeds
  -> RUN_PERFORMANCE_TESTS?
       false: skip with no extra build time
       true: reset fixtures -> run k6 -> archive reports -> record decision
  -> promotion/release decision
```

For the first 3–5 stable releases:

- use the `release` profile in pre-production;
- leave `PERF_ENFORCE_THRESHOLDS=false`;
- fail on readiness or response correctness;
- compare p50/p95/p99 and error trends between unchanged releases; and
- agree final blocking thresholds only after variance is understood.

Load, stress, and soak profiles are pre-production-only and should be manually selected, not run on
every ordinary release. Production load is not part of this framework.

## 7. How to read a result

| Signal | Healthy meaning | Investigate when |
| --- | --- | --- |
| Checks | All expected status/body checks pass | Any repeated authentication, readiness, or message response failure |
| HTTP failure rate | Near zero | Sustained 4xx/5xx during steady traffic |
| Message p95/p99 | Stable compared with approved baseline | Tail latency climbs with VUs or release version |
| VUs and request rate | Match the selected profile | Generator cannot create expected traffic |
| API p95 | Tracks k6 latency without a large unexplained gap | Route latency rises while traffic is steady |
| DB/Redis/queue/Zero | No saturation or growing backlog | Connections, lag, queue age, errors, or memory keep rising |

The load generator proves **that** the system slowed down. Application metrics help determine
**why**. If PostgreSQL, Redis, queue, or Zero metrics are missing, report the root cause as unknown
instead of guessing.

## 8. Release evidence template

```text
Performance test report
Release / commit: <version or SHA>
Environment: sandbox | preprod
Run ID: <metadata.json runId>
Scenario / profile: messaging / release
Traffic: <peak VUs and duration>
Result: PASS | PRODUCT_FAILURE | TEST_FAILURE | ENVIRONMENT_FAILURE | OBSERVABILITY_FAILURE
Checks / error rate / p95: <short values>
Grafana: <dashboard link and time window>
Jenkins artifacts: <build artifact link>
Decision: Go | Investigate | Approved waiver
Owner / approver: <name>
```

## 9. Common mistakes to avoid

- Do not run `load`, `stress`, or `soak` against sandbox or production.
- Do not put tokens in Jenkins string parameters, commands, Git, HTML, JSON, or Grafana labels.
- Do not use one shared identity if it hides real session/concurrency behaviour.
- Do not compare runs with different data size, infrastructure, or traffic shape as if equivalent.
- Do not retry a genuine threshold failure until it passes; record and investigate it.
- Do not enforce the provisional 300 ms p95 until owners approve it from baseline evidence.

## 10. Your practical learning order

1. Run `pnpm perf:validate` and read the validation tests.
2. Dry-run the launcher and inspect the secret-safe Docker command.
3. Run readiness smoke against sandbox.
4. Run messaging with 1 VU, then 5 VUs.
5. Find the same run ID in Grafana.
6. Explain one HTML report to your senior.
7. Trigger the Jenkins stage with `RUN_PERFORMANCE_TESTS=true`.
8. After 3–5 comparable runs, help propose the blocking p95/error criteria.

That order teaches framework, application behavior, observability, and release decision-making
without beginning with unsafe high load.
