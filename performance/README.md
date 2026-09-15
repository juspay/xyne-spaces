# Xyne performance testing

This directory contains the CI-neutral Grafana k6 framework for XYNE-63166. Jenkins runs it now;
a future GitHub Actions workflow can call the same `pnpm perf:run` command.

## Scenarios

| Scenario | Endpoint | Writes? | What it covers |
| --- | --- | --- | --- |
| `smoke` | `GET /api/health/readiness` | no | Connectivity and database readiness. Start here. |
| `zero-query-transform` | `POST /api/zero/query` | no | The query-transform step: auth, rate limit, ACL, tenant scoping, AST compile. |
| `rest-messaging` | `POST /api/conversations/:id/messages` | **yes** | The REST send path used by bots, the Claw MCP route and attachment uploads. **Gated — see below.** |

### `zero-query-transform` — what it is, precisely

The name is deliberately narrow. This is an **authenticated Zero query-transform test**, not a
Zero-sync test and not a full read-load test.

It measures authentication, the per-user Zero rate limiter, query construction,
`scopeQueryToTenant`, ACL application and AST compilation — the work `handleQueryRequest` does in
`apps/backend/src/zero/server.ts`.

It does **not** measure:

- **Postgres execution or row transfer.** The endpoint answers with compiled ASTs; rows reach
  clients over the Zero sync socket. (`/api/zero/query-fallback` does execute, against the
  read-replica pool, but it is a different path and is currently unmetered.)
- **Anything on the write or fan-out path** — no push/mutation, no Socket.IO or Redis fan-out, no
  unread recomputation, no message side effects.

Request format, verified against `@rocicorp/zero` 1.9.0 rather than inferred from the public docs:

```json
["transform", [{"id": "q1", "name": "conversationMessagesV2", "args": [{"conversationId": "..."}]}]]
```

The batch is wrapped in a `["transform", …]` tuple (`zero-protocol/src/custom-queries.js`), and each
query's arguments are array-wrapped because the server reads `args[0]`
(`zero-server/src/queries/process-queries.js`). A malformed request is answered
`{"kind": "TransformFailed", …}` with **HTTP 200**, so the scenario checks the body, never the
status alone.

### `rest-messaging` is gated

It writes a message row per iteration and no reset exists yet, so `pnpm perf:run` refuses it unless
`PERF_ALLOW_WRITE_SCENARIOS=true` is set. See "Cleanup" below. It is also deliberately **not**
named `messaging`: the chat UI does not use this endpoint, so its numbers must not be read as the
user-facing send path.

## Coverage against the approved priority

`docs/performance-testing-priority-decision.md` approved **Wave 1** as the connected pipeline —
`/api/zero/push`, `/api/zero/query`, `POST /api/conversations/:id/messages`, Socket.IO, Redis
pub/sub, typing/presence, unread counts and message side effects — with steady-state **message
send** as the first implementation milestone.

What is built here covers a slice of that, and the gap is deliberate, not forgotten:

| Approved scenario | Status |
| --- | --- |
| 0 — reconnect/retry characterisation (Socket.IO) | **not built.** Needs a socket client; k6 HTTP cannot reach it. |
| 1 — steady-state message send | **not built.** The real send path is the Zero mutator `messages.send` → `POST /api/zero/push`, whose request envelope is undocumented (Zero's own docs say to read the `handleMutateRequest` source). `rest-messaging` hits a REST endpoint the chat UI does not use. |
| 2 — participant fan-out wall | **not built.** Depends on scenario 1. |
| 3 — mixed human + external-source ingest | **not built.** |
| 4 — soak and recovery | profile exists; the pipeline it should soak does not. |
| — readiness / connectivity | `smoke`. |
| — part of `/api/zero/query` | `zero-query-transform` (transform step only, no SQL). |

So the serving-lag and chat-send risks that motivated the original priority are **not yet
reproducible** by this framework. Zero push and WebSocket/Socket.IO load remain the next scenarios
and are required for that.

## Workload profiles

`smoke`, `release`, `load`, `stress`, `soak`. Every completed run writes a self-contained
`report.html`, `summary.json` and `metadata.json`, and can optionally Remote Write to
VictoriaMetrics for the Grafana dashboard.

Routine runs accept only `sandbox` and `preprod`. Production is deliberately rejected. Sandbox is
restricted to the short `smoke` and `release` profiles; capacity profiles run only in pre-production.

## Identity fixture sizing

The Zero endpoints are rate limited **per authenticated user** (300 requests / 60s by default), so
`zero-query-transform` runs need enough distinct identities to reach their target rate — 20 for
`load`, 60 for `stress`. The runner refuses a run whose fixture is too small rather than letting the limiter be
reported as a product failure. Full table and rationale: `performance/test-data/README.md`.

## Dependencies

Required locally:

- Node.js and pnpm already used by this repository;
- Docker with permission to run `grafana/k6:2.2.0`; and
- network access from the Docker container to the selected environment.

No npm k6 dependency, Java, JMeter, InfluxDB, or Grafana Cloud subscription is required.

## 1. Validate the framework

```bash
pnpm perf:validate
```

This is an offline, fast check. It does not send application traffic.

## 2. Run the readiness smoke test

```bash
PERF_BASE_URL=https://sandbox.example.com \
PERF_RELEASE_VERSION=1.298.0 \
pnpm perf:smoke
```

Start here. A new timestamped directory appears under `performance/reports/`.

## 3. Prepare test identities

Copy `performance/test-data/users.example.json` to an ignored file such as
`performance/test-data/users.sandbox.json`. Replace every placeholder with a short-lived token and
IDs from a dedicated, resettable performance workspace. Size the fixture per the table in
`performance/test-data/README.md`.

## 4. Confirm the contract with one authenticated request

Before the first real run, confirm the endpoint accepts the envelope, with a real token from your
fixture. The format is verified against the library source, but only a live call also confirms
authentication, the query names and ACL behaviour on your target:

```bash
curl -sS -X POST "$PERF_BASE_URL/api/zero/query" \
  -H "Authorization: Bearer $TOKEN" \
  -H "x-workspace-id: $WORKSPACE_ID" \
  -H 'Content-Type: application/json' \
  -d '["transform",[{"id":"q1","name":"allTickets","args":[{}]}]]'
```

Expect `{"kind":"QueryResponse","queries":[{"id":"q1","name":"allTickets","ast":{…}}]}`. A
`{"kind":"TransformFailed",…}` body — which arrives with HTTP 200 — means the envelope or the query
name is wrong. Fix that before running load.

## 5. Run a small Zero query-transform test

```bash
PERF_BASE_URL=https://sandbox.example.com \
PERF_RELEASE_VERSION=1.298.0 \
PERF_USERS_FILE=performance/test-data/users.sandbox.json \
pnpm perf:run -- --environment sandbox --profile release --scenario zero-query-transform --vus 5 --duration 2m
```

Reads only, so this needs no workspace reset. The duration override changes the steady stage;
ramp-up and ramp-down are preserved.

`setup()` makes one authenticated request before load starts, so a stale fixture token, a wrong
envelope or a renamed query fails immediately as an `ENVIRONMENT_FAILURE` instead of surfacing later
as a latency regression.

## 5b. The REST send path (gated — writes rows)

```bash
PERF_ALLOW_WRITE_SCENARIOS=true \
PERF_BASE_URL=https://sandbox.example.com \
PERF_RELEASE_VERSION=1.298.0 \
PERF_USERS_FILE=performance/test-data/users.sandbox.json \
pnpm perf:run -- --environment sandbox --profile release --scenario rest-messaging --vus 5 --duration 2m
```

Without the opt-in the runner refuses. Do not raise it beyond `release` until the cleanup question
below is answered — and remember it is not the path the chat UI uses.

## Cleanup (open)

`rest-messaging` inserts a row per iteration, each one also enqueuing a Vespa index job and
side-effect fan-out. A `soak` at 25 VUs and 1s think time is roughly 360,000 messages. Messages are
tagged `PERF-<run-id>-<userId>-<vu>-<iter>` so they can be found and removed, but **no teardown is
implemented yet**. Decide one of: a k6 `teardown()` that deletes by marker, a documented pre/post
reset job, or a throwaway workspace per run — before running a capacity profile of
`rest-messaging` against pre-production.

`zero-query-transform` is unaffected: it writes nothing.

## 6. Send metrics to VictoriaMetrics

```bash
PERF_REMOTE_WRITE_URL=https://victoriametrics.example.com/api/v1/write \
PERF_REMOTE_WRITE_USERNAME="$METRICS_USER" \
PERF_REMOTE_WRITE_PASSWORD="$METRICS_PASSWORD" \
PERF_BASE_URL=https://preprod.example.com \
PERF_RELEASE_VERSION=1.298.0 \
PERF_USERS_FILE=performance/test-data/users.preprod.json \
pnpm perf:run -- --environment preprod --profile release --scenario zero-query-transform
```

Open the provisioned **Xyne k6 Performance Testing** dashboard and choose the generated run ID.
Do not embed VictoriaMetrics credentials in its URL.

## Threshold policy

Correctness checks always fail the command. Performance limits are report-only during the first
3–5 stable baseline releases. After owners approve the p95 target, set
`PERF_ENFORCE_THRESHOLDS=true` in the protected Jenkins configuration to make HTTP failure rate and
the scenario's latency percentile blocking (`message_send_duration` p95 < 300ms for
`rest-messaging`, `zero_query_duration` p95 < 400ms for `zero-query-transform`).

## Output and result meaning

Each run directory contains:

- `report.html`: human-readable k6 dashboard;
- `summary.json`: full machine-readable k6 summary; and
- `metadata.json`: environment, profile, scenario, release, run ID, and timestamps.

An exit code of `0` means all enabled gates passed. Exit code `2` from the launcher means invalid
configuration or an environment/runner problem. Other non-zero k6 exits require the console and
report to distinguish product thresholds from test or observability problems.

Never commit reports, real tokens, customer content, or generated identity files.
