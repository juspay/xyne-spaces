# Xyne Spaces Performance and Load Testing Plan

**Status:** Proposal for approval  
**Audience:** Engineering management, QA, platform, backend, and release owners  
**Scope:** Xyne Spaces release quality gates and scheduled capacity testing

## 1. Executive summary

Xyne Spaces should adopt a **post-deployment, two-tier performance-testing programme**:

1. A short, deterministic **k6 release-performance check** after sandbox and pre-production deployment.
2. Longer **nightly and pre-major-release capacity tests** for search, real-time collaboration, queues, ingestion, and AI-dependent flows.

The recommended primary tool is **Grafana k6**, executed from a pinned Docker image in the CI system. k6 is preferred over Apache JMeter for Xyne because its JavaScript test scripts fit the TypeScript monorepo, its tests review cleanly in Git, it supports HTTP and WebSocket scenarios, and it works well with the repository's existing OpenTelemetry, VictoriaMetrics, and Grafana stack.

Apache JMeter is not prohibited. Use it only when an existing JMeter suite must be reused, a vendor supplies a JMX file, or the organisation standardises on Azure Load Testing, which supports JMeter and Locust. It should not be the default for new Xyne tests.

The performance check must not begin as a full stress test on every release. It should be a 10–15 minute critical-path regression test that starts **after deployment has completed**, outside the normal build pipeline. Stress, spike, and soak tests belong in scheduled workflows because they are slower, more costly, and more likely to create noise.

This approach keeps normal CI build time unchanged. The release owner receives a report and records a go/no-go decision in the release notes or release checklist. Automation can be added later if the organisation decides the added time is justified.

## 2. Why this matters for Xyne Spaces

Xyne is a multi-service CRM/workspace application. Important user journeys cross several performance boundaries:

- Express/Node backend and Prisma/Postgres;
- Redis and Bull workers;
- Vespa search;
- Zero/Y-Sweet real-time collaboration and WebSocket connections;
- attachments/storage; and
- external integrations and AI providers.

A unit test can confirm that an endpoint works. It cannot show whether a realistic number of users makes the search service slow, exhausts database connections, causes Redis queue backlog, or degrades real-time sync. A controlled performance suite exposes these regressions before they reach users.

The repository already provides useful foundations:

- GitHub Actions CI (`.github/workflows/CI-pr.yml`, `CI-push.yml`, and `ci.yml`);
- health and readiness endpoints under `/api/health`;
- OpenTelemetry instrumentation in the backend;
- VictoriaMetrics and Grafana in local infrastructure; and
- test-only Desk routes plus `apps/backend/scripts/generate-load-test-tokens.ts`.

## 3. What similar CRM/platform projects do

Public guidance from established CRM platforms points to the same operating model:

| Practice | Industry evidence | Xyne decision |
| --- | --- | --- |
| Use a dedicated, production-like test environment | Salesforce advises using a full-copy sandbox rather than production for performance testing; Dynamics 365 guidance calls for a dedicated performance environment. | Run repeatable load tests in sandbox or pre-production with isolated credentials and data. |
| Model realistic business traffic | Salesforce’s scale-test guidance calls for a concurrency model, throughput targets, a ramp plan, and measurement of how closely the test represents production. | Build scenarios from Xyne’s most-used flows and production telemetry, then revise quarterly. |
| Run small controlled tests repeatedly | Salesforce describes “laboratory testing” as ongoing endpoint tests in CI before deployment. | Run the short test after sandbox/pre-production deployment now; it can become an automated promotion gate later if needed. |
| Observe both client results and service telemetry | Azure Load Testing retains and compares historical runs, and exposes server-side metrics; Dynamics identifies data, code, configuration, and design as performance factors. | Correlate k6 results with OTEL/Grafana metrics for DB, Redis, Vespa, Node, and queues. |
| Manage API quotas and third-party limits | Salesforce documents rate limits and recommends multiple users for realistic simulation. | Use dedicated test users; mock or control third-party integrations and LLM calls. |

Sources: [Salesforce CI/laboratory testing guidance](https://developer.salesforce.com/docs/commerce/b2c-commerce/guide/performance.html), [Salesforce performance-test sandbox guidance](https://developer.salesforce.com/blogs/2020/09/introduction-to-performance-testing), [Salesforce scale-test planning](https://developer.salesforce.com/blogs/2025/02/load-test-on-the-salesforce-platform-using-scalability-tools), [Dynamics 365 performance-testing guidance](https://learn.microsoft.com/en-us/dynamics365/guidance/implementation-guide/testing-strategy-test-types), and [Azure Load Testing overview](https://learn.microsoft.com/en-us/azure/app-testing/load-testing/overview-what-is-azure-load-testing).

## 4. Tool decision: k6 versus JMeter

| Criterion | k6 (recommended) | Apache JMeter |
| --- | --- | --- |
| Test format | JavaScript files | XML `.jmx` plans, often edited in a GUI |
| Fit for Xyne | Strong: JavaScript/TypeScript developers can review and maintain it | Adequate, but introduces a Java/GUI-oriented workflow |
| HTTP/API testing | Strong | Strong |
| WebSocket/realtime testing | Supported and practical for scripted flows | Possible, typically with plugins/configuration |
| Git review and reuse | Small modules, readable diffs, shared helpers | XML diffs can be noisy |
| CI execution | Simple CLI or Docker image | CLI execution is possible, but needs Java and test-plan handling |
| Scale option | Local/CI, Kubernetes operator, or Grafana Cloud k6 | Local/CI or managed services such as Azure Load Testing |

**Decision:** adopt k6 OSS with a pinned Docker image. Do not add a runtime package to `apps/backend/package.json`. Developers may install k6 locally with `brew install k6`; CI should use `grafana/k6:<pinned-version>` so execution is repeatable. k6 thresholds produce a non-zero exit code, allowing the CI system to enforce SLOs. See the [k6 install guide](https://grafana.com/docs/k6/latest/set-up/install-k6/) and [threshold documentation](https://grafana.com/docs/k6/latest/using-k6/thresholds/).

**When JMeter is appropriate:** choose JMeter only if a customer/vendor gives Xyne a maintained JMX suite, an organisation-wide testing platform requires it, or Azure Load Testing is mandated. Azure Load Testing currently supports JMeter and Locust rather than k6; that is an infrastructure/platform choice, not a reason to replace k6 in this repository.

## 5. Test types and when to run them

| Test | Purpose | Duration | Trigger | Blocks release? |
| --- | --- | ---: | --- | --- |
| Smoke performance test | Detect obvious endpoint regressions at low traffic | 2–3 min | Manual / after sandbox deployment | No |
| Release critical path | Protect normal user experience under expected traffic | 10–15 min | After sandbox and pre-production deployment | No automatic block; release-owner sign-off required |
| Load/capacity test | Validate expected peak volume | 30–60 min | Nightly | No; create ticket/alert |
| Stress and spike test | Find breaking point and recovery behaviour | 30–60 min | Weekly or before major launch | No; release-readiness review |
| Soak test | Find leaks, queue growth, and gradual degradation | 4–8 hr | Weekly/monthly | No; release-readiness review |

## 6. Where performance testing sits in the CI/CD pipeline

```text
Pull request
  -> unit, integration, security, E2E checks
  -> build immutable image/artifact              (unchanged CI duration)
  -> deploy to sandbox
  -> run 2–3 min k6 smoke check separately
  -> share report in release channel / attach to release notes
  -> deploy the same artifact to pre-production
  -> run 10–15 min k6 release-critical-path separately
  -> release owner records go / investigate / waiver decision
  -> deploy the same artifact to production
  -> production synthetic checks and telemetry monitoring
```

### GitHub Actions versus Jenkins

The checked-in Xyne CI uses GitHub Actions; there is no repository `Jenkinsfile`. The cost-cutting default is deliberately **not** to add k6 to the existing build workflow. Therefore:

- **Default:** add a manually triggered GitHub Actions workflow, `.github/workflows/performance-on-demand.yml`. The release owner selects `sandbox` or `preprod`, enters the release version, and starts it after deployment. It does not delay the build.
- **Cheapest initial option:** run `pnpm perf:smoke` or `pnpm perf:release` from a secure engineering runner/laptop against the deployed environment, then attach the generated report to release notes. This is appropriate for the first few runs, but use a shared runner once the process becomes routine so it does not depend on one person's machine.
- **If Jenkins performs deployment outside this repository:** Jenkins may offer a separate, manually invoked `Performance Test` job. It should invoke the same versioned command after deployment and readiness, use Jenkins credentials for secrets, and archive the same report.
- **Do not duplicate test logic** in GitHub Actions and Jenkins. The scripts and thresholds live in Git; the workflow/job is only the runner.

This design lets the team keep CI fast, move CI systems later, and still retain a repeatable, reviewable performance record.

### Environment policy

| Environment | What to run | Why |
| --- | --- | --- |
| Sandbox | 2–3 minute smoke test after each relevant deployment | Fast confidence that core endpoints and authentication work at low load. |
| Pre-production | 10–15 minute release-critical-path test for each release candidate | Best place for the release decision; environment should be production-like. |
| Pre-production | 30–60 minute capacity test only nightly or before high-risk/major releases | Controls cloud cost and avoids delaying ordinary releases. |
| Production | Synthetic health/user-journey probe and dashboard monitoring only | Validates the live release without intentionally creating heavy customer-facing load. |

Do not routinely run load, stress, or soak tests against production. If a production capacity exercise is ever necessary, it needs written approval, a traffic limit, rollback plan, monitoring owner, and a quiet maintenance window.

## 7. Initial release scenario

The first release gate should cover a small, stable, business-critical API journey:

1. Obtain/use a short-lived dedicated test-user token.
2. Check `/api/health/readiness`.
3. Load an authenticated workspace/dashboard summary.
4. List a representative page of tickets or conversations.
5. Run a representative Vespa-backed search.
6. Create or update a record belonging only to the test workspace.
7. Verify the result and clean up/reset through the controlled fixture mechanism.

Later scenarios should be separate files:

- `search-and-workspace.js` for read/search pressure;
- `realtime-sync.js` for Zero/Y-Sweet/WebSocket connections;
- `queue-ingestion.js` for Bull/Redis workers and ingestion;
- `attachments.js` for controlled storage paths; and
- `ai-workflows.js` using deterministic mock responses or a controlled test provider.

Do not use production Slack, Google, Microsoft, or LLM credentials in the suite. Network latency, quotas, and provider outages would make a release decision unreliable and could create real customer-side effects.

## 8. Pass/fail criteria

The release test must use both **functional checks** and **performance thresholds**.

### Initial candidate thresholds

These values are starting guardrails, not final contractual SLOs. Baseline them for three to five stable releases, then tune them using real traffic and product expectations.

| Metric | Initial pass criterion | Failure outcome |
| --- | ---: | --- |
| Health/readiness success | 100% | Fail immediately |
| Authentication success | >= 99% | Fail |
| Critical API HTTP error rate | < 1% | Fail |
| Critical API p95 latency | < 800 ms | Fail |
| Search p95 latency | < 1.5 s | Fail |
| Write-action p95 latency | < 1.5 s | Fail |
| WebSocket connection success (once added) | >= 99% | Fail |
| Unhandled 5xx rate | < 0.5% | Fail |
| Sustained DB/Redis/Vespa saturation | No sustained saturation during steady state | Fail/release review |

Use endpoint-specific k6 tags and thresholds. Do not assess only global average latency: an average can look healthy while search or ticket writes are slow for users. k6 thresholds are designed to codify these SLOs and return a failed process exit code when breached.

### Release handling for the post-deployment model

- **Sandbox smoke failure:** do not promote the candidate; publish report and assign an owner.
- **Pre-production threshold failure:** release owner marks the release `investigate`; publish the report/Grafana link and assign an owner. Production deployment proceeds only with a documented, time-bound waiver from the agreed approver.
- **Infrastructure/test-environment failure:** rerun only after the platform owner confirms the environment was invalid. Do not silently waive a test failure.
- **Known, approved exception:** time-bound waiver recorded in the release ticket with owner and expiry date.

Each report should contain: release version/commit SHA, environment, start/end time, scenario, virtual-user profile, threshold result, report link, Grafana link, decision, and approver. A small template in the existing release notes or team channel is sufficient at first.

## 9. Basic implementation plan

### Phase 0 — establish the lightweight operating process (half day)

1. Name an engineering owner and a release owner.
2. Choose the first business journey: recommended default is workspace load + ticket/conversation list + search + safe write.
3. Obtain expected peak concurrent-active-user and transactions-per-minute estimates from product/operations.
4. Agree that normal CI stays unchanged and that test reports are posted in the release channel and linked from release notes.
5. Agree that sandbox/pre-production are test targets; production receives only synthetic checks.

### Phase 1 — prepare the environment (2–5 days)

1. Ensure pre-production has production-like versions and configuration; use sandbox only for the cheaper smoke test.
2. Give it a dedicated Postgres database, Redis namespace, test workspace, object-storage prefix, and test users.
3. Seed a representative but anonymised data volume. Search indexes and ticket/conversation volumes must be realistic enough to matter.
4. Add an automatic reset/seed job before each test. The reset must not touch production.
5. Verify Grafana panels for Node, database, Redis, Bull queues, Vespa, and WebSocket services.

### Phase 2 — add the first k6 test (1–3 days)

1. Create `performance/k6/scenarios/release-critical-path.js`.
2. Add reusable modules under `performance/k6/lib/` for configuration, authentication, data selection, and checks.
3. Read `K6_BASE_URL` and `K6_TEST_TOKEN` from environment variables; never hard-code secrets.
4. Run locally against test infrastructure at one user, then at a small ramp.
5. Save the k6 end-of-test summary as a CI artifact.

Proposed repository layout:

```text
performance/
  k6/
    lib/
      config.js
      auth.js
      thresholds.js
    scenarios/
      release-critical-path.js
      search-and-workspace.js
      realtime-sync.js
  README.md
.github/workflows/
  performance-on-demand.yml
  performance-nightly.yml
```

### Phase 3 — make post-deployment execution repeatable (1–2 days)

1. Add a root `perf:release` command that runs the versioned k6 scenario.
2. Add `performance-on-demand.yml` with a `workflow_dispatch` environment input (`sandbox` or `preprod`) and release-version input. Alternatively, configure one equivalent manual Jenkins job if Jenkins owns deployment.
3. Use a pinned `grafana/k6` Docker image in the manual runner/job.
4. Pass `PERF_BASE_URL` and `PERF_TEST_TOKEN` through runner secrets; never enter tokens as workflow inputs.
5. Upload k6 JSON summary, console summary, and Grafana URL even when the job fails.
6. Post a release-channel/report template automatically if practical; otherwise attach it manually.
7. Run in report-only mode for 3–5 releases to establish the baseline. Keep the human sign-off process until it proves valuable enough to automate.

### Phase 4 — expand safely (ongoing)

1. Add nightly capacity tests for search, queue ingestion, and collaboration.
2. Add weekly stress/spike tests and monthly soak tests.
3. Review results monthly with platform and product teams.
4. Recalculate workload mixes after major product changes or customer growth.

## 10. Dependencies and cost

### Required

- k6 binary locally, or the `grafana/k6` Docker image in CI;
- a dedicated performance environment;
- test credentials and data reset mechanism;
- existing monitoring exported to Grafana; and
- GitHub Actions secrets, Jenkins credentials, or a controlled secure runner.

### Not required for the first version

- Grafana Cloud k6 subscription;
- Kubernetes k6 operator;
- JMeter;
- browser performance testing; or
- a new APM product.

Grafana Cloud k6 or a Kubernetes k6 operator can be evaluated later if one CI runner cannot generate the required load or results need managed cross-run comparison. k6 supports local, distributed, and cloud execution modes. [k6 execution modes](https://grafana.com/docs/k6/latest/get-started/running-k6/)

## 11. Risks and safeguards

| Risk | Safeguard |
| --- | --- |
| Test harms customers or production data | No routine load test targets production; use dedicated environment, users, storage prefix, and reset job. |
| Test is unrealistic | Use telemetry-based workflow mix, production-like data volume, multiple users, and quarterly review. |
| External APIs or LLMs create flaky gates | Mock them or use a controlled test provider. |
| Test passes but backend is saturated | Inspect Grafana resource/queue dashboards in the same run window. |
| Test is too slow for releases | Do not add it to CI; run short checks post-deployment and move stress/soak to schedules. |
| Thresholds are arbitrary | Establish baselines before enforcing final SLOs. |

## 12. Approval decisions needed

Before implementation, agree on:

1. Peak concurrent-active-user target and expected peak transaction rate for the next 6–12 months.
2. The first critical user journey to protect.
3. Whether pre-production has sufficiently production-like data/configuration, and who owns its cost/data reset.
4. Whether a manually dispatched GitHub Action, Jenkins job, or secure shared runner is the initial test runner.
5. The owner who may approve time-bound performance-gate waivers.

## 13. Recommended decision

Approve **k6 OSS + post-deployment manual execution + isolated sandbox/pre-production + existing Grafana observability** as the initial implementation. Keep normal CI unchanged. Start with a report-only smoke check in sandbox and a report-only critical-path test in pre-production for 3–5 releases; record the release-owner decision in release notes. Add nightly capacity tests only after the first process is stable and trusted. Consider an automatic promotion gate later only if the team decides its risk reduction is worth the added release time.
