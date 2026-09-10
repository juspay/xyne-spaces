# Performance Testing: Beginner Implementation Runbook

This runbook explains how to start performance testing in Xyne Spaces from zero experience. It follows the decisions in [the performance and load testing plan](./performance-load-testing-plan.md).

## 1. The simple idea

Performance testing means asking the application to behave as though several users are using it at the same time, then measuring:

- whether requests succeed;
- how long they take; and
- which backend component becomes slow.

For Xyne, use **k6** as the traffic generator. k6 sends HTTP and WebSocket requests from a JavaScript test script. Grafana shows the backend evidence: API, database, Redis, Vespa, queue, CPU, and memory behaviour.

You do **not** need to build a big new “framework” first. Start with this lightweight structure:

```text
performance/
  k6/
    scenarios/          # One file per user journey
    lib/                # Reusable config, auth, test-data helpers
    reports/            # Generated locally; ignored by Git
  README.md             # How to run each scenario
```

The first scenario can be one file. Create reusable helpers only after two scenarios need the same logic.

## 2. Learn five words before starting

| Word | Simple meaning |
| --- | --- |
| Virtual user (VU) | One simulated person using Xyne. |
| Scenario | The actions that virtual users perform, for example open workspace → list tickets → search. |
| Ramp | Increase users gradually instead of sending all traffic at once. |
| p95 latency | 95 out of 100 requests finished within this time. It reveals slow requests that averages hide. |
| Threshold | The pass/fail rule, for example “p95 search must be below 1.5 seconds.” |

## 3. What to test first

Start with one safe, common journey. Recommended first journey:

```text
Login as a test user
  -> check readiness
  -> load workspace/dashboard data
  -> list tickets or conversations
  -> search
  -> create one test-only record
  -> verify the record
```

This is better than starting with AI, imports, attachments, integrations, or real-time collaboration because it is easier to make safe and repeatable.

## 4. Where tests are allowed to run

| Environment | Allowed test | Never do |
| --- | --- | --- |
| Local machine | One or a few users against local/test data | Infer production capacity from it. |
| Sandbox | 2–3 minute smoke performance test | Use customer data or real provider credentials. |
| Pre-production | 10–15 minute release-critical-path test; scheduled capacity test | Use production secrets. |
| Production | Low-volume synthetic health/user journey only | Routine load, stress, or soak test. |

Production load testing is not the starting point. It can slow or harm real customer activity and increases cloud cost.

## 5. First-time setup checklist

Complete these items in order. Do not start writing a test until items 1–4 are true.

1. **Choose an owner.** One engineer owns the first scenario; one release owner reads the result.
2. **Choose a target environment.** Start with sandbox, then pre-production.
3. **Create a dedicated test workspace and user.** The account must have only test data. Never reuse an employee or customer account.
4. **Choose a reset method.** Before each run, either restore known fixtures or use an endpoint/job that clears only the test workspace.
5. **Install a runner locally.** On macOS: `brew install k6`. Check it with `k6 version`.
6. **Confirm monitoring.** Open Grafana and find dashboards for backend, Postgres, Redis/Bull, Vespa, and any relevant realtime service.
7. **Record baseline information.** Release version, environment URL, test-user identifier, start time, and expected traffic level.

The repository already has helpful test foundations: backend health endpoints, test-only routes, and `apps/backend/scripts/generate-load-test-tokens.ts`. Reuse them only in the dedicated test environment—do not expose test helpers in production.

## 6. Build the first test in small steps

### Step A — prove the runner works

Create a temporary k6 test that calls the sandbox readiness endpoint with one user. Its only job is to prove:

- k6 can reach the environment;
- TLS/DNS/network access works; and
- a report is produced.

Do not add authentication or concurrency yet. A failed first run should be easy to diagnose.

### Step B — add authentication

Use an environment variable such as `K6_TEST_TOKEN`; do not put a token in a JavaScript file or commit it to Git.

Test with one request first. If authentication fails, fix the test account or token generation before adding load.

### Step C — add the read-only journey

Add workspace load, ticket/conversation list, and search. For each request, record:

- expected status code;
- endpoint name/tag; and
- response-time measurement.

Keep this first version read-only. Read-only tests are easier to repeat while learning.

### Step D — add one safe write

Add one create/update action that is restricted to the dedicated test workspace. Give every created item a predictable prefix such as `PERF-<run-id>` so cleanup is safe.

Immediately add cleanup or reset before raising user counts. A performance test that keeps creating records becomes slower every time it is run and eventually stops measuring the real product behaviour.

### Step E — add a small ramp

Use this beginner traffic profile:

```text
1 minute: ramp from 0 to 5 users
3 minutes: hold at 5 users
1 minute: ramp from 5 to 10 users
1 minute: ramp down to 0
```

Run this three times against the same deployed version. If the results vary widely, fix environment/data/monitoring issues before changing thresholds.

### Step F — add thresholds

Start with these candidate rules:

| Check | Candidate rule |
| --- | --- |
| Readiness | 100% success |
| Authenticated requests | >= 99% success |
| Critical API p95 | < 800 ms |
| Search p95 | < 1.5 s |
| HTTP request failures | < 1% |

These are guardrails, not final promises. Baseline them for 3–5 releases and then agree on final SLOs with product/platform owners.

## 7. How to run after a release deployment

This is the routine your team should follow.

### After sandbox deployment

1. Confirm the deployment is healthy with `/api/health/readiness`.
2. Reset/seed the dedicated performance workspace.
3. Run the 2–3 minute smoke scenario.
4. Save the k6 result and note the Grafana time window.
5. Post a short report in the release group.
6. If it fails, stop and investigate before relying on sandbox for further validation.

### After pre-production deployment

1. Confirm the exact release version/commit SHA deployed.
2. Reset/seed the performance workspace.
3. Start the 10–15 minute critical-path scenario.
4. During the test, observe Grafana for API, Postgres, Redis/Bull, Vespa, CPU, memory, and queue depth.
5. Save the result to the release record.
6. Release owner records one decision: **Go**, **Investigate**, or **Approved waiver**.

### After production deployment

1. Do not run load traffic.
2. Run a low-volume synthetic check: health, authentication, and a simple read/search journey.
3. Watch error rate, latency, CPU, memory, DB/Redis/Vespa metrics for the agreed observation window.
4. Attach the production verification link to release notes.

## 8. What a release report looks like

Copy this into the release group or existing release notes:

```text
Performance test report
Release / commit: <version or SHA>
Environment: sandbox | pre-production
Scenario: smoke | release-critical-path
Start / finish: <UTC timestamps>
Traffic: <virtual-user ramp>
Result: PASS | FAIL | ENVIRONMENT ISSUE
Thresholds: <summary>
Grafana: <dashboard link with time range>
k6 artifact: <report link>
Decision: Go | Investigate | Approved waiver
Owner / approver: <name>
```

## 9. When to add automation

Begin manually. Once the team can run and interpret the test reliably, add a manual GitHub Actions workflow or Jenkins job. It should:

1. Ask for environment (`sandbox` or `preprod`) and release version.
2. Load URL/token from protected secrets.
3. Run the same version-controlled k6 scenario in a pinned Docker image.
4. Upload the report even when it fails.
5. Optionally post the result to the release channel.

This is **manual automation**: one button starts a repeatable job, but it does not add time to every CI build.

Only after several successful releases should the team consider an automatic promotion gate.

## 10. What to build later, not now

Do not begin with these. Add them after the first scenario is trusted:

- WebSocket/Zero/Y-Sweet collaboration scenario;
- queue and ingestion scenario;
- attachment upload scenario;
- AI workflow scenario using mocks;
- nightly capacity test;
- stress/spike test; and
- long soak test.

## 11. Your first practical task

Before any code, answer these four questions in the release ticket or document:

1. What sandbox URL will be used?
2. Which dedicated test workspace and user can be safely reset?
3. Which first journey should we test: **tickets**, **conversations**, or **search**?
4. Who will read the report and decide whether a result is acceptable?

Once those are answered, create the first one-user readiness test. That is the correct first implementation milestone—not a large framework or a 100-user load test.
