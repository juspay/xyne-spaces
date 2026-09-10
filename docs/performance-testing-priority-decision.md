# Performance-Testing Priority Decision

**Date:** 2026-09-02  
**Decision:** Start performance and load testing with the **real-time messaging and Zero-sync pipeline**.  
**Inputs reviewed:**

- `performance-load-testing-priority-xyne-spaces-2026-09-02T09-05-28.html`
- `perf-priority-addendum-new-prod-signals-xyne-spaces-2026-09-02T09-07-41.html`
- Relevant Xyne source under `apps/backend/src/`

## Decision in one sentence

The first performance-testing module is not “chat” alone: it is the connected **Zero sync → message send → Socket.IO/Redis fan-out → unread counts and message side effects** pipeline, with external-source ingest included as a concurrent writer.

## Why this module comes first

The two supplied reports independently rank this pipeline first. Their production-signal summary identifies high traffic, high error volume, websocket errors/retries, and severe Zero serving-lag spikes. The addendum makes this more urgent by reporting a client Socket.IO retry/fail storm and high-volume external-source ingestion with write-conflict signals.

Repository inspection independently confirms the main scaling shape:

| Code evidence | What it means for load testing |
| --- | --- |
| `apps/backend/src/routes/zero.ts` exposes authenticated `/push` and `/query` operations. | Zero must be exercised as the real-time client-sync backbone, not only by ordinary REST endpoint tests. |
| `apps/backend/src/routes/conversations.ts` maps `POST /:conversationId/messages` to `replyToConversation`. | Message send is the primary user-facing write action. |
| `conversationController.replyToConversation` broadcasts locally through `websocketService.broadcastToSession`, then again through `redisService.broadcastMessageToSession`, and starts `MessagesSideEffectHandler` asynchronously. | One message exercises delivery, horizontal fan-out, and downstream work; test it as one end-to-end scenario. |
| `websocketService.handlePresenceEvent` calls `this.io.emit('user_status_updated', ...)`. | Presence changes can broadcast to every socket on a server; connection and presence churn must be measured. |
| `zero/utils/unreadCountUtlis.ts` states that unread recomputation reads/writes each recipient’s rows. | Channel participant count is a critical test dimension, not just request rate. |
| `integrations/routes/external-source-sync.ts` processes inbound ingest synchronously after authenticating the source. | Inbound integration traffic can contend with human message writes, so include it as a mixed workload. |

## Evidence caveat

The HTML reports contain production metrics and Grafana/VictoriaMetrics references, but this decision process did not directly query their Grafana instance. Treat the reported volumes, latencies, retry rates, and lag values as strong prioritisation signals that must be verified in the current production dashboard before setting permanent thresholds.

This caveat does **not** change the selected module: code structure and both reports point to the same Wave-1 risk.

## Priority order

| Wave | Module / request cluster | Decision | Reason |
| --- | --- | --- | --- |
| 1 | **Real-time messaging + Zero sync**: `/api/zero/push`, `/api/zero/query`, `POST /api/conversations/:id/messages`, Socket.IO, Redis pub/sub, typing/presence, unread counts, message side effects | Build first | Largest blast radius and strongest production failure/capacity signals. |
| 1b | **External-source ingest**: `/api/external-source-sync/:sourceName/ingest` | Add to the Wave-1 mixed-load scenario | Writes to the same message/email ecosystem and is reported as high volume with contention/constraint symptoms. |
| 2 | **Search**: Vespa + ACL-filtered queries | Build second | Important user journey and reported high read latency; less urgent than real-time failure signals. |
| 2 | **Tickets / boards**: ticket list, board aggregation, duplicate detection | Build third | Slow reported tail latency; add concurrent board-viewer tests after search. |
| 3 | Notification, Vespa indexing, automations/radar/workflows | Observe during Wave 1, then test directly | They are downstream of messages and may be the reason load accumulates. |
| 4 | Email Desk and AI/LLM modules | Test separately with controlled providers/mocks | External latency, quotas, and nondeterminism make poor first release-test signals. |

## The first scenarios to build

Build them in this order. Do not start with a maximum-user test.

### Scenario 0 — reproduce and characterise reconnect/retry behaviour

**Goal:** establish whether the reported Socket.IO retry/fail pattern can be reproduced in a controlled environment.

- Create a fixed number of authenticated clients.
- Establish real-time connections.
- Introduce controlled disconnect/reconnect cycles.
- Measure connection attempts, failures, reconnect time, and connection leakage.

**Pass evidence:** no growing reconnect rate, no unbounded open connections, and no sustained error increase after recovery.

### Scenario 1 — steady-state message send

**Goal:** measure the normal message-write path under realistic concurrent use.

- Multiple users send text-only messages to separate test conversations.
- Each client performs Zero query/push operations as a real client would.
- Begin with small groups, then repeat with larger participant counts.
- Keep attachment, AI, and external-provider features disabled in this first version.

**Measure:** send p95/p99, HTTP failures, Zero query/mutate latency, Socket.IO delivery lag, Zero hydration time, serving lag, database pool/CPU, Redis operations, and queue depth.

### Scenario 2 — participant fan-out wall

**Goal:** identify the effect of per-recipient unread work and notification fan-out.

- Keep message rate steady.
- Run the same scenario with increasing channel sizes: for example 5, 25, 100, then the largest safe production-like size.
- Compare latency and downstream queue behaviour at each size.

**Measure:** message p95, unread/notification processing time, database workload, Redis broadcast volume, and queue backlog.

### Scenario 3 — mixed human messages plus external-source ingestion

**Goal:** detect contention between inbound integration writes and user writes.

- Run Scenario 1 at a stable baseline.
- Add controlled test webhook/ingest events using test-only source credentials and data.
- Use idempotent fixtures so duplicate handling is intentional and measurable.

**Measure:** message and ingest error rates, unique-constraint failures, `zero_mutation_error` count, database latency, Zero serving lag, and queue backlog.

### Scenario 4 — soak and recovery

**Goal:** find gradual backlog, memory growth, and recovery problems.

- Run a low/normal mixed workload for several hours in pre-production.
- Stop traffic and confirm queues and lag return to baseline.

**Measure:** memory trend, connection count, event-loop/CPU trend, queue depth, replication/serving lag, and error rate before/during/after recovery.

## Provisional Wave-1 KPIs

Do not make these release blockers until they are baselined. They are the measures to collect from the first runs:

| KPI | Desired first guardrail |
| --- | --- |
| Message-send p95 | Under 300 ms for text-only messages in the agreed normal channel size |
| Socket delivery lag p95 | Under 500 ms |
| Zero query/mutate p95 | At or better than current agreed baseline; investigate sustained regression |
| Zero serving lag | Below 10 seconds during steady state and returns after load stops |
| WebSocket/reconnect failures | Near zero in a stable run; no increasing retry pattern |
| HTTP 5xx and message/ingest errors | Below 1%; any recurring constraint failure investigated |
| Queue depth | No upward drift during steady state; returns after traffic stops |

The exact values must be confirmed by a product/platform owner after 3–5 repeatable baseline runs and current-production telemetry review.

## Required observability before running meaningful load

The reports call out an important blind spot: no direct PostgreSQL and Redis metrics were available in the referenced VictoriaMetrics view. Before interpreting a failure as “application code is slow,” ensure the dashboard contains:

- application request rate, errors, p95/p99 by route;
- Zero active clients, hydration, WebSocket errors, and serving/replication lag;
- Node CPU, memory, and event-loop indicators;
- PostgreSQL connection count, CPU/IO, slow-query/query-time metrics; and
- Redis latency, operations, memory, and Bull queue depth/age.

Without these, the traffic generator can show *that* the system slows down but not reliably identify *why*.

## What not to do first

- Do not start with browser/UI performance, AI generation, large attachments, or every API route.
- Do not run routine load tests in production.
- Do not use real Gmail/Slack/Microsoft/LLM credentials.
- Do not use one shared user/token for all virtual users if it invalidates the concurrency model.
- Do not set permanent pass/fail numbers from a single run.

## First implementation milestone

Create one pre-production k6 scenario for **Scenario 1: steady-state text-message send**, using a dedicated resettable workspace and several dedicated test users. It should generate a report and Grafana time window only; it is report-only for the first 3–5 releases.

After that works consistently, add Scenario 0 and Scenario 2. Scenario 3 follows once test webhook fixtures are safe and repeatable.
