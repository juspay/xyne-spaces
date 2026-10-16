# Claw metrics API: tables, indexes, complexity and measured cost

Reference for every claw metrics HTTP API (`/claw/api/v1/metrics/*`) and the write path that feeds them: tables and indexes touched, time and space complexity, and measured cost at prod scale.

- **Code**: branch `feature/claw-metrics-v2`, migration `20261015120000_agent_run_tool_and_llm_stats`. Measured 2026-10-16.
- **Data model**: `agent_runs` gains no columns. Two new tables hold the metrics, both with plain columns:
  - `agent_run_stats`: one row per finished run: tool totals, the tools it used (`toolNames`), its per-call model series (`llmCalls`) and its citation outcome.
  - `agent_run_tool_stats`: one row per tool per finished run: call counts, timings, duration buckets and failure classes.
  - `agent_runs` gets one covering index (`agent_runs_metrics_window_idx`) for the run-level aggregates.
- **Write path**: both tables are written after a run's finalize has committed, outside its transaction and lock, so a metrics write can never slow down or fail a run (§4).
- **Machine caveat**: a laptop running Postgres 16 with `shared_buffers` 128 MB under other load (load average 2.4 to 5 for the final numbers). Read absolute times as upper bounds; plan shapes and buffer counts are the load-independent evidence.

**Headline**:
- Every run-level aggregate (summary, daily series, leaderboard, picker roster, routes) is an index-only scan of `agent_runs_metrics_window_idx`. Every tool figure is a plain `GROUP BY` over `agent_run_tool_stats`.
- No card reads `toolInvocations` or any other `agent_runs` blob on page load. Only the opt-in exact citations do.
- Every endpoint returned 200 at every scope measured.
- Cold first paint per tab at 30 days workspace (§6): Overview 0.35 to 0.44 s, Coverage 0.39 to 0.45 s, Quality 0.60 to 0.64 s, Tools 0.45 to 1.08 s, LLM 0.98 to 1.10 s. After that each cached card answers in 2 to 30 ms.
- Heaviest cold reads left: `/llm-calls` 0.8 to 1.2 s (exact percentiles over about 300k calls); `/sentiment` about 0.9 s (regex over `agent_runs.result`); opt-in exact citations 4 to 6 s.

Contents: 1 Summary table, 2 Notation and method, 3 Per-API reference, 4 Write path and backfill, 5 Caching, 6 Client loading plan, 7 Before vs after, 8 Operational notes.

## 1. Summary table

Symbols are in §2. "Cold" is the first request for a fresh cache key (range over at least 2 rounds); "warm" is served from the server cache. 30-day workspace unless noted.

| Endpoint | Purpose | Tables (columns read) | Indexes / plan (30d ws) | Time | Space (response) | Cold / warm |
|---|---|---|---|---|---|---|
| `GET /summary` | headline figures, current and previous window | `agent_runs` (covering); `agent_run_stats` (scalar columns) | `agent_runs_metrics_window_idx` Index Only Scan; `agent_run_stats` Parallel Seq Scan on the bench, its `(orgId, completedAt)` index in prod | Θ(R_o + R'_o) + O(R log R) sorts | O(1), 1.9 KB | 0.33 to 0.37 s / 4 to 5 ms; 7d 0.05 to 0.14 s |
| `GET /runs/daily` | per-day series and trigger table | `agent_runs` (covering) | metrics_window Index Only Scan | Θ(R_o) + O(R log R) | O(D·G), 12 KB | 0.09 to 0.36 s / 2 to 6 ms |
| `GET /agents/top` | agent leaderboard | `agent_runs` (covering); `agent_run_stats` (`toolCalls`, `toolErrors`); `organizations` (all-orgs only) | metrics_window Index Only Scan; one pass over the window's stats rows | Θ(R_o) + O(R log R) + Θ(R) | O(A), 7 KB | 0.21 to 0.26 s / 3 to 4 ms |
| `GET /agents/active` | picker roster, always 30d | `agent_runs` (covering) | metrics_window Index Only Scan, HashAggregate | Θ(R_o) | O(A), 1.7 KB | 15 to 36 ms / 2 ms |
| `GET /routes` | route × model table | `agent_runs` (covering) | metrics_window Index Only Scan | Θ(R_o) + O(R log R) | O(routes), 1.1 KB | 39 to 76 ms / 2 to 3 ms |
| `GET /sentiment` (one agent) | ratings, rates, comments, memory recall | `agent_runs` (heap: **`result`**, rating, comment); `memory_recall_hits` | BitmapAnd(`agentSlug_startedAt`, `completedAt_triggerSource`) | O(N_a + R_w) + R_a heap + O(R_a·\|result\|) | 2.2 KB | 30d xyne 0.3 to 2.4 s / 2 to 14 ms |
| `GET /tools` | per-tool rollup, rankings, coverage | `agent_run_tool_stats` (counters, `durationBuckets`); scalars from `agent_runs`, `agent_run_stats` | Bitmap Index Scan `agent_run_tool_stats_orgId_completedAt_idx` (256k rows), HashAggregate (120 groups) | Θ(R·k) rows + O(K) groups | O(P), 25 KB at 25 rows | 0.45 to 1.84 s (1.8 s first read after a restart) / 3 to 13 ms; 30d xyne 0.10 to 0.29 s; 7d 0.04 to 0.05 s |
| `GET /tools/error-classes` | failure modes; one tool for the drawer | `agent_run_tool_stats` (`errors`, `errorClasses`) | `(orgId, completedAt)` with `errors > 0`; `(orgId, tool, completedAt)` for one tool | Θ(R·k) index entries + Θ(E) unnested classes | O(limit), 1.5 KB | card 0.07 to 0.09 s, drawer 0.02 to 0.03 s / 2 to 3 ms |
| `GET /tools/citations` | cite funnel, reflection, flags; `exact=1` | the rollup; `agent_run_stats` (`citationOutcome`); `agents`; exact also `agent_runs` (**`result`**, **`toolInvocations`**) | reflection: stats rows in the window; exact: §3.8 | rollup + Θ(R); exact Θ(R·\|result\|) + Θ(R_c·B) | O(A), 2.9 KB; exact +O(K) | 0.10 to 0.15 s / 2 ms. exact: 7d ws 4.8 to 5.7 s, 30d xyne 3.9 to 4.3 s, 400 in 10 to 20 ms at 30d ws |
| `GET /tools/unused-grants` | palette hygiene | `agent_run_stats` (`toolNames`); `agents`; `tools` | Seq Scan of `agent_run_stats` at 30d ws, agent index for one agent | Θ(R) + Θ(R·\|toolNames\|) | O(A + unused), 3.6 KB | 0.16 to 0.23 s / 2 ms; 30d xyne 0.07 s |
| `GET /llm-calls` | per-LLM-call figures | `agent_run_stats` (`llmCalls`, `llmCallCount`); `agent_runs` (covering, run count) | Parallel Seq Scan of `agent_run_stats`; metrics_window Index Only Scan | Θ(R·C) + O(R·C log R·C) | O(models + 48), 5.2 KB | 0.83 to 1.23 s / 3 to 19 ms; 30d xyne 0.24 to 0.29 s |
| `GET /sessions` | drill-down lists (tool, failed, slow, model) | tool kinds `agent_run_tool_stats`, others `agent_runs`; `users`; model kind `agent_run_stats` | tool kinds: `agent_run_tool_stats_orgId_tool_completedAt_idx`, newest first; metrics_window for the rest | tool: O(log N + M_w) bitmap or O(P/ρ) ordered walk; slow Θ(R_o) | O(P), 8 to 16 KB | 0.02 to 0.23 s (never cached) |
| `GET /global` (legacy) | apps/dashboard workspace shape | composed from the blocks above | composed | sum of the blocks | O(D + A + 20), 22.6 KB | 0.16 to 0.27 s / 3 ms |
| `GET /agent/:slug` (legacy) | apps/dashboard agent shape | composed blocks | composed | sentiment dominates | 21.7 KB | 30d xyne 0.36 to 0.57 s / 4 to 7 ms |
| `GET /agent/:slug/improvements`; `POST /improvements/:id/apply\|dismiss`; `POST /improvements/backfill` | FailureCurator candidates | `agents`, `user_roles`, `agent_shares`, `agent_improvement_candidates` | unique `(slug, orgId)`; `(agentSlug, status, updatedAt)` | O(log N + I_a log I_a); backfill is LLM-bound | ≤ 100 rows | 10 to 30 ms (empty tables) / 2 ms |
| `GET /awakening`, `GET /awakening/:agentId/runs` | awakened-agent activity | `agent_awakening_runs`, `agent_awakening_state`, `agents`, `agent_runs` | `(orgId, startedAt)`; `(agentId, windowStartMs)`; `sessionId_key` | 4 × Θ(W); O(W_a + offset) | ≤ 15 KB; O(P) | 29 to 40 ms / 7 ms (empty tables) |
| `POST /tools/backfill` | write stats rows for runs that lack them (admin button loops it in slices of `maxRows` 5000) | `agent_runs` (`toolInvocations`, `result`, `toolsUsed`, `metadata`); writes both stats tables | `agent_runs_pkey` walk with an anti-join on `agent_run_stats_pkey` | O(N) per full pass + O(B) per summarised run | O(1), about 150 B | 969 local runs (force) in 1.1 s; one missed run 0.16 s; nothing to do 15 ms |

## 2. Notation and method

### 2.1 Symbols

| Symbol | Meaning | Bench value (30d workspace / 30d `xyne` / 7d workspace) |
|---|---|---|
| N | rows in `agent_runs` (all orgs, all time) | 200,000 |
| R | runs in the window and scope (finished, orphans excluded) | 44,969 / 8,613 / 10,283 |
| R' | runs in the previous window of the same length | 45,217 (30d workspace) |
| R_o | runs of the org in the window: the key range of `agent_runs_metrics_window_idx` and of the stats tables' `(orgId, completedAt)` indexes. An agent or user filter is applied on top, so agent-scoped reads still walk R_o entries unless they use an agent index | 44,969 |
| R_w | runs of every org in the window (what `agent_runs_completedAt_triggerSource_idx` returns; it has no `orgId`) | 49,919 |
| N_a | all-time runs of the filtered agent (sentiment and exact citations read the `agent_runs` heap and pay it: `agent_runs_agentSlug_startedAt_idx` is keyed on `startedAt`, so a `completedAt` window only uses its `agentSlug` prefix) | 39,123 (`xyne`) |
| T | tool calls per run | 7.57 |
| k | tool rows per run that called a tool | 6.62 (256,181 tool rows for 38,691 runs at 30d ws) |
| K | distinct tools in the window | 120 |
| C | LLM calls per run | 7.2 per run in the window, 8.5 per run that has a series |
| E | tool rows with an error in the window | 12,973 (13,160 errored calls) |
| J | distinct (tool, error class) pairs | 720 |
| A | agents with runs in the window | 20 |
| D | days in the window | 30 / 30 / 7 |
| P | page size | sessions 25 (max 50); tool rows 50 (max 200) |
| M_w | tool rows of one tool in the window | 1 to 9,608 (`search-tools`) |
| B | stored `toolInvocations` bytes per run | 13.0 KB |
| W | awakening rows in the window | 0 (tables empty on the bench) |
| ρ | share of window runs matching a drill-down filter | per request |
| Local to one section | E_t errored rows of one tool; r_g rows in one group; R_a runs of one agent in the window; H memory-recall hits; I_a improvement candidates; W_a awakening rows of an agent; G grants per agent; U_g unused grants; R_c runs in conversations that cite anything | |

### 2.2 Bench

- 200,000 `agent_runs` over 120 days in schema `bench` of the local `claw_auth_db` (2 orgs, the main one holds 90%). Every finished run has an `agent_run_stats` row (42,582 with a model-call series, 20,238 with a citation outcome). `agent_run_tool_stats` holds 1,176,195 rows (5.9 per run, 59,437 with an error). Compacted with `VACUUM FULL`; the stats rows were checked against the real writer (§4.3).
- Sizes: `agent_runs` heap 497 MB, TOAST 2.8 GB, `agent_runs_metrics_window_idx` 41 MB. The two stats tables together are 580 MB, about 2.9 KB per run (§8.1).
- Fully vacuumed (63,551 of 63,552 heap pages all-visible), so index-only scans show 0 or 1 heap fetches.
- Rows were inserted in random time order (`completedAt` correlation about 0); in prod they arrive in time order. A 30-day window touches about 29k scattered heap pages here against about 16k contiguous ones in prod, so heap-reading statements are pessimistic. Index-only scans show about 21k buffer hits per 45k entries (visibility-map page switches); expect about 1.3k in prod.
- Machine: Apple Silicon, 12 cores, 18 GB, Postgres 16.15 in OrbStack. `shared_buffers` 128 MB, `work_mem` 4 MB, `random_page_cost` 4, 2 parallel workers, `jit` on (`runAnalytics` turns it off per statement). The 3.3 GB heap plus TOAST is 25 times `shared_buffers`, so cold requests read from the OS cache or disk and vary 2 to 5 times between rounds.

### 2.3 How each number was taken

- **Plans**: `EXPLAIN (ANALYZE, BUFFERS)` through the backend's own Prisma client with the SQL builders' real bind parameters, inside a transaction with `SET LOCAL jit = off` (plus `force_custom_plan` for `/sessions`). EXPLAIN adds per-row timing overhead, so its times are upper bounds. Scopes: 30d workspace (admin), 30d `xyne`, 7d workspace.
- **HTTP**: a metrics-only harness (`metricsRouter` plus `metricsToolsRouter`, auth stubbed to the bench admin) against the bench, 3 rounds.
  - **cold** = first request for a fresh cache key. The key carries the window end floored to the minute, so each group started in a fresh minute; `window.cached = false` confirmed it.
  - **warm** = immediate repeats from the in-process LRU (the harness never opens Redis).
  - **quiet cold** = a pass where each request first waited until no other query was active.
  - Times are wall-clock to the last byte; bytes are the uncompressed JSON body (claw-auth has no compression).

## 3. Per-API reference

All routes live under `/claw/api/v1/metrics`, mounted as `requireAuth`, `requireNoAccessToken`, `metricsRouter`, `metricsToolsRouter` (`src/http/routes.ts`).

**Common start of every v2 GET** (`resolveRequestWindow`, `lib/metrics-core.ts`): `isClawAdmin` (`user_roles` unique `(userId, role)`, about 0.2 ms); a `users` pkey lookup for the org only when `x-org-id` is missing (prod's `requireAuth` stamps it); then the window: `completedAt` in `[windowEnd − D days, windowEnd)` with `windowEnd` = now floored to the minute, plus `orgId =` (admin) or `userId =` (non-admin), the agent filter and the orphan exclusion `("error" IS NULL OR "error" <> 'interrupted (orphaned run)')`.

**Execution**: every statement goes through `runAnalytics` (`lib/metrics-sql.ts`, the only file in the metrics code that runs raw SQL), a `$transaction` of one `set_config` statement (`statement_timeout` 8 s, `jit` off, transaction-local) and the query, holding one pooled connection. Handlers keep at most 3 statements in flight (`boundedAll`). v2 responses start with `window: WindowInfo` (about 200 B).

**Stats readers** window `agent_run_stats` and `agent_run_tool_stats` on their own copies of `orgId`, `userId`, `agentSlug` and `completedAt` (`statsWindowPredicate`). No orphan predicate and no join to `agent_runs` are needed: orphan-closed runs never get stats rows.

### 3.1 GET /summary

- **Purpose**: headline figures for the window and the previous window of equal length: runs, outcomes, success rate, distinct users, end-to-end p50/p95, agent time and its LLM/tool/other split, reply start p50/p95, tokens per run, cache hit rate, tokens/s, tool calls and errors, tool-stats coverage, runs with a model-call series.
- **Called by**: `HeadlineKpis` (P0 on every tab); legacy `/global` and `/agent/:slug` and agent tool `get_agent_metrics view=overview` (same `summary` cache block).
- **SQL** (3 statements in parallel): `runSummarySql` for the current and for the previous window on `agent_runs` (FILTER counts, `count(DISTINCT userId)`, 3 `percentile_cont` pairs, averages, token sums); `statsSummarySql` on `agent_run_stats`, one pass over both windows with FILTERed counts and sums (scalar columns only, never `llmCalls` or `toolNames`).
- **Columns**: `agent_runs` covering columns only; `agent_run_stats` `orgId`, `completedAt`, `agentSlug`, `userId`, `toolCalls`, `toolErrors`, `llmCallCount`.
- **Plans**: current 44,965 rows, Index Only Scan, 1 heap fetch, 72 to 153 ms; previous 45,216 rows, 71 to 110 ms; stats Parallel Seq Scan of `agent_run_stats` (the two windows are half of the 120-day bench table; prod uses the `(orgId, completedAt)` index), 88,800 rows, 165 ms.
- **Time**: Θ(R_o + R'_o) index tuples plus O(R log R + R' log R') for 4 sorts per window (3 percentiles, distinct users); the sorts dominate. Plus Θ(R + R') narrow stats rows. **Space**: DB O(R) per ordered-set aggregate (the distinct-user sort spills 4.6 MB at default `work_mem`); response O(1).
- **Bench**: 30d ws 0.33 to 0.37 s cold, 4 to 5 ms warm, 1,862 B; 30d xyne 0.18 to 0.71 s; 7d ws 0.05 to 0.14 s.
- **Notes**: `tools.runsSummarised` is the number of runs with a stats row; coverage is that over `runs` (older runs get rows from the backfill). An all-orgs admin scope has no `orgId =` equality and falls back to the `completedAt` bitmap plus heap (opt-in, not measured).

### 3.2 GET /runs/daily?tz=

- **Purpose**: zero-filled calendar days in `tz`: runs by outcome and trigger group, end-to-end p50/p95, agent-time averages and totals, tokens; plus the trigger-group table.
- **Called by**: Overview P1 (`TimeSplitCard`, `RunTimeCard`, `RunsPerDayCard`, `TriggerMixCard` share one request); legacy `/global` and `/agent/:slug`.
- **SQL**: `runDailySql`, one statement: a subquery computes `day` (`completedAt AT TIME ZONE 'UTC' AT TIME ZONE $tz`), the trigger group and wall time, then `GROUP BY GROUPING SETS ((day), (grp), (day, grp))` with `percentile_cont`. Columns: `agent_runs` covering columns only.
- **Plan** (30d ws): Index Only Scan, 44,965 rows, 1 heap fetch, 21,233 buffer hits, Sort (external merge 2.9 MB), GroupAggregate (191 groups), 116 / 78 ms. 30d xyne 25 / 30 ms; 7d ws 20 / 18 ms.
- **Time**: Θ(R_o) plus O(R log R) for the sort (which dominates) plus Σ O(r_g log r_g) for percentiles; Node O(D) zero-fill. **Space**: DB O(R) sort; response O(D × G), G ≤ 8, about 400 B per day.
- **Bench**: 30d ws cold 356 / 225 / 88 ms (quiet 109 to 176 ms), warm 6 ms, 12,157 B; 30d xyne 28 to 90 ms; 7d ws 21 to 25 ms, 3,866 B.
- **Notes**: `tz` is a validated IANA bind parameter and part of the cache key, so viewers in different zones do not share an entry.

### 3.3 GET /agents/top?limit=20

- **Purpose**: agent leaderboard: runs, failed, success rate, end-to-end p50/p95, agent-time averages, tokens per run, tool calls, tool error rate.
- **Called by**: Overview leaderboard (P2, workspace scope only); legacy `/global`; agent tool `view=overview`.
- **SQL**: `agentLeaderboardSql`, one statement. CTE `top`: `GROUP BY agentSlug, orgId` over `agent_runs` with percentiles, `ORDER BY runs DESC LIMIT $n`. CTE `tools`: `sum(toolCalls)`, `sum(toolErrors)` per agent from `agent_run_stats`, one pass over the window (filtering to the listed agents first made the planner probe the agent index per agent: 448 ms against 99 to 238 ms). Then `top LEFT JOIN tools`; `organizations` (`id`, `name`) only in all-orgs scope.
- **Time**: Θ(R_o) index-only plus O(R log R) group sort plus Θ(R) stats rows plus O(A log A). **Space**: DB O(R) sort; response O(min(A, limit)), about 340 B per agent.
- **Bench**: 30d ws cold 0.21 to 0.26 s, warm 3 to 4 ms, 6,960 B.

### 3.4 GET /agents/active

- **Purpose**: every agent with a finished run in the last 30 days, whatever the page range and agent filter; feeds the agent picker.
- **Called by**: `AgentPicker`, only after first touched; unioned with the `/agents?scope=all` roster.
- **SQL**: `activeAgentsSql`: `GROUP BY agentSlug, orgId`, `count(*)`, `LIMIT 500`. Plan: Index Only Scan (44,965 rows, 21,230 hits), HashAggregate (20 groups), 14 / 15 ms.
- **Time**: Θ(R_o) over 30 days plus O(A). **Space**: O(A), capped at 500 rows.
- **Bench**: cold 23 to 36 ms, warm 2 ms, 1,737 B; TTL 5 min. Replaces a full `/global?days=30` fetch on every page load.

### 3.5 GET /routes

- **Purpose**: run-level route (`agent_runs.provider`) × model: runs, timed n, LLM p50/p95, reply start p50/p95, weighted tokens/s, failure rate.
- **Called by**: Overview "Model time by route and model" (P2); legacy `/global`.
- **SQL**: `routeTableSql`: `GROUP BY provider, model` with `provider IS NOT NULL` and 4 percentiles. Columns: `agent_runs` covering (`provider`, `model` are INCLUDEd).
- **Plan** (30d ws): Index Only Scan, 43,973 rows, 21,230 hits, Sort (external merge 2.4 MB), GroupAggregate, 39 / 37 ms. 30d xyne 15 ms; 7d ws 8 ms.
- **Time**: Θ(R_o) plus O(R log R). **Space**: O(routes × models).
- **Bench**: 30d ws cold 43 to 76 ms, warm 3 ms, about 1.1 KB (4 rows); 30d xyne 19 to 30 ms; 7d ws 12 to 15 ms.

### 3.6 GET /sentiment?agentSlug=<one>

- **Purpose**: for one agent: thumbs up/down, cancelled/failed/retried/apologetic rates and denominators, 12 recent comments, memory-recall adoption. Without exactly one `agentSlug` it answers 400 in 1 to 5 ms.
- **Called by**: Overview sentiment card (P2, single agent only); legacy `/agent/:slug`.
- **SQL** (3 statements in parallel): `sentimentSql` (FILTER counts plus `result ~* $pattern`, `APOLOGETIC_PATTERN` bound so backslashes survive); `sentimentCommentsSql` (`ORDER BY ratedAt DESC NULLS LAST LIMIT 12`); `memoryRecallSql` (`count(DISTINCT sessionId)` of `memory_recall_hits` restricted to the window's sessions, plus an `EXISTS` "captured" probe).
- **Columns**: `agent_runs` heap: **`result`** (TOAST-able, detoasted for the regex), `rating`, `ratingComment`, `ratedAt`, `llmRetries`, `status`, `sessionId`; `memory_recall_hits` `agentSlug`, `orgId`, `userId`, `sessionId`. Not index-only by design: `result` cannot be index payload.
- **Plan** (30d xyne): main = BitmapAnd(`agent_runs_agentSlug_startedAt_idx` 39,123 entries, `agent_runs_completedAt_triggerSource_idx` 49,919) then Bitmap Heap Scan of 8,501 blocks, 8,613 rows, 2,315 / 264 ms; comments reuse the bitmap, 28 / 18 ms; memory 0.2 ms (table empty on the bench, so not measured at scale).
- **Time**: O(N_a + R_w) bitmap build plus R_a heap pages plus O(R_a × \|result\|) regex and detoast; memory O(H log N). Cold the heap and TOAST reads dominate (17k blocks read); warm the regex over about 8.3k results does (264 ms). **Space**: DB O(1) plus an O(R_a) bitmap; response about 2.2 KB.
- **Bench**: 30d xyne cold 4.65 / 1.50 / 1.56 s (quiet 0.6 to 1.8 s), warm 2 ms, 2,245 B.
- **Caveat**: cold is over 1 s at 30d for a busy agent, and its cost grows with the agent's all-time history (N_a), not the window.

### 3.7 GET /tools?sort=&dir=&limit=&offset=&search=

- **Purpose**: per-tool rollup (calls, runs, errors, not-found, recovered/unrecovered, dropped, duplicates, empty, citeable, cited, latency estimated from duration buckets, bytes and context share, run counts per signal), window totals, three rankings (time, context, errors), tool-stats coverage. Sort, search and paging happen in Node on the cached rollup.
- **Called by**: Tools tab table and ranked card (P1); the drawer lookup (`search=<tool>`) when the tool is off the page; Quality tab table and drills (`sort=duplicates|uncited`); Overview "Slowest tools" (`limit=5`, one agent); legacy `/agent/:slug` `toolLatency`; agent tool `view=overview|tools|tool_failures`. All share the `tools/rollup` block.
- **SQL**: `toolRollupSql`: `SELECT tool, count(*), sum(calls), …, sum(durationBuckets[1..13]), count(*) FILTER (WHERE errors > 0), … FROM agent_run_tool_stats WHERE <window> GROUP BY tool` (plain column aggregates, no unnest, no CTE). In parallel `fetchToolScalars` (runs from `agent_runs` index-only, stats rows with and without a tool call from `agent_run_stats`); `tools/coverage` is the same scalar statement under its own key.
- **Columns**: `agent_run_tool_stats` every counter and `durationBuckets`; run counts from `agent_runs` covering columns and `agent_run_stats` scalars. `toolInvocations` is never read.
- **Plan**: 30d ws Bitmap Index Scan `agent_run_tool_stats_orgId_completedAt_idx` then Bitmap Heap Scan and HashAggregate (120 groups), 256,209 tool rows, 1.02 s with cold reads (22k pages), about 0.4 s cached. 30d xyne reads the same org window and filters (about 49k kept), 178 ms. 7d ws 52,108 rows, 26 ms.
- **Time**: Θ(R·k) tool rows, each feeding about 34 aggregate transitions, plus O(K) hash groups; Node O(K log K) for the rankings, then O(K log K) sort plus O(P) slice per request. **Space**: DB O(K); Node cached rollup about 40 KB; response O(P) at about 1 KB per row plus 3 rank sets.
- **Bench** (limit 25): 30d ws cold 0.45 to 1.08 s in the tab (1.84 s first read after a restart), warm 3 to 13 ms, 25,344 B; 30d xyne 0.10 to 0.29 s; 7d ws 0.04 to 0.05 s.
- **Caveats**:
  - p50/p95 are **estimated from duration buckets** (12 log edges up to 300 s plus an overflow bucket, linear interpolation), accurate to within a bucket; `p95Overflow` marks a p95 above 300 s. Averages and maxima are exact.
  - An agent filter reads the whole org window and filters it (no `(orgId, agentSlug, completedAt)` index on the tool table); at 178 ms a third index was not worth it.

### 3.8 GET /tools/error-classes?tool=&limit=&offset=&perTool=

- **Purpose**: failure modes per tool: normalised class, occurrences, distinct runs, a sample of up to 400 characters, last seen, not-found flag. `perTool` caps classes per tool (the card); `tool` narrows to one tool (the drawer).
- **Called by**: Tools failure-modes card (`limit=6&perTool=2`); tool drawer (`tool=…&limit=10&offset=`); agent tool `view=tool_failures`.
- **SQL** (1 statement on `agent_run_tool_stats`): CTE `g` does `CROSS JOIN LATERAL jsonb_array_elements(errorClasses)` over the window's rows with `errors > 0`, grouped by (tool, class): `sum(count)`, `count(*)` runs, `min(sample)`, `max(completedAt)`, `bool_or(notFound)`; `ranked` adds `row_number()` per tool, `kept` applies `rn <= perTool`; result is a `json_agg` page plus `total` and `occurrences`. Columns: `orgId`, `completedAt`, `agentSlug`, `userId`, `tool`, `errors`, `errorClasses`. Never touches `agent_runs` or a blob.
- **Plan** (30d ws, 82 ms): Bitmap Index Scan `agent_run_tool_stats_orgId_completedAt_idx` (256k entries), heap rows with `errors > 0` (12,973), 13,160 class entries, 720 groups. The drawer uses `(orgId, tool, completedAt)`.
- **Time**: Θ(R·k) index entries + Θ(E) unnested classes + O(J log J) window function + O(limit); with `tool`: O(log N + E_t). **Space**: DB O(J); response O(limit), about 210 B per class.
- **Bench**: card cold 0.07 to 0.09 s, warm 3 ms, 1,507 B; drawer (`tool=post_document`) 0.02 to 0.03 s, 2 ms, 1,533 B.
- **Caveats**: `lastSeen` is the finish time of the last run that hit the class (calls are not stored one by one). `sample` is the first sample of the class per run and the card shows the smallest, so it is an example, not the latest error. Each (tool, limit, offset, perTool) is its own cache entry.

### 3.9 GET /tools/citations?exact=1

- **Purpose**: same-turn citation funnel (from the rollup), citation-reflection outcomes, per-agent `autoToolCitations` / `citationReflection` flags; `exact=1` adds conversation-scoped cite rates per tool.
- **Called by**: Quality tab (`useCitations`); `exact=1` only behind a toggle, and only when the client allows it (an agent filter or `days <= 7`).
- **SQL**: (1) the `tools/rollup` block (shared in flight with `/tools`); (2) in parallel, reflection (`citationOutcome` `GROUP BY` on `agent_run_stats`) and pairs (`SELECT DISTINCT agentSlug, orgId` on `agent_runs`); (3) `agent.findMany(OR (orgId, slug) pairs)`. For `exact=1`: the gate (agent filter or at most 7 days) runs before any cached block, then a run-count cap (at most 15,000 runs), then `toolCiteRatesSql` with a 15 s timeout: `cited_ids` (`regexp_matches(result, …)` over the window's runs), `per_tool` (calls minus dropped, and citeable calls, from `agent_run_tool_stats`), `cited_runs` (runs with tool calls in citing conversations, windowed on `agent_run_stats` so it reads that table's index), `cited` (those runs' invocation blobs, each element projected to (tool, call id) before the join).
- **Columns**: `agent_run_stats` `citationOutcome`, `toolCalls`; `agent_run_tool_stats` `calls`, `dropped`, `citeable` (exact); `agent_runs` covering for pairs, exact also **`result`**, **`toolInvocations`** (TOAST, about 13 KB per run), `conversationId`, `sessionId`; `agents` (`config`, `delegationTier`).
- **Plan, exact 7d ws** (2.47 s warm): `cited_ids` is an Index Scan of `agent_runs_metrics_window_idx` reading every answer in the window (about 2.6 s of 5.5 s cold); `cited_runs` reads 8,858 rows through `agent_run_stats_orgId_completedAt_idx` in 10 ms; `per_tool` reads 52k tool rows in a few ms; the rest is the cited runs' blobs.
- **Time**: base = rollup + Θ(R) + O(A); exact adds Θ(R × \|result\|) for the regex, Θ(R_c × B) bytes for citing conversations, and O(R_c·T log(R_c·T)) for the join sort. **Space**: response O(A), 2.9 KB; exact +O(K) (6.5 to 12.8 KB); the join does not spill.
- **Bench**: base 30d ws cold 0.10 to 0.15 s (0.60 to 0.64 s with the whole Quality tab), warm 2 ms, 2,895 B. Exact: 7d ws 4.8 to 5.7 s (12,807 B), 30d xyne 3.9 to 4.3 s (6,484 B), 30d ws answers 400 at once from the gate (78 B).
- **Caveat**: `exact=1` is an opt-in diagnostic and the most expensive request of the page: the regex reads every answer in the window and the answer/invocation TOAST (2.8 GB) is 20 times `shared_buffers`.

### 3.10 GET /tools/unused-grants

- **Purpose**: palette state per agent (`scoped`, `open-palette`, `unscoped`), granted/used/unused counts, unused grants with their server. Observed tools = each stats row's `toolNames`: the run's `toolsUsed` merged with the tools its recorded calls named. Neither list alone is complete (some finalize paths omitted `toolsUsed`; about 6% of `toolsUsed` entries have no recorded call), and a used tool must never be reported unused.
- **Called by**: Coverage tab (P1); agent tool `view=coverage`.
- **SQL**: (1) observed: `GROUP BY agentSlug, orgId` with `array_agg(DISTINCT t)` over `LEFT JOIN LATERAL unnest(toolNames)` on `agent_run_stats`; (2) `agent.findMany(OR pairs)`; (3) `grantServers`: `tool.findMany` for the exact slugs and `__<name>` suffixes, an exact slug first, then slug order; (4) grant matching in TypeScript (`findUnusedGrants`).
- **Columns**: `agent_run_stats` `toolNames` (`text[]`, inline) and window columns; `agents`; `tools` (`slug`, `source`). It does not read `agent_runs`.
- **Plan**: 30d ws Seq Scan of `agent_run_stats` (81 MB on the bench) + HashAggregate; 30d xyne Index Scan `agent_run_stats_orgId_agentSlug_completedAt_idx`, 32 ms; servers under 1 ms.
- **Time**: Θ(R) stats rows (Θ(N) with the seq scan) + Θ(R × \|toolNames\|) + O(A·G) matching + O(U_g × \|tools\|). **Space**: DB O(A × distinct tools); response O(A + unused grants).
- **Bench**: 30d ws cold 0.16 to 0.23 s, warm 2 ms, 3,641 B; 30d xyne 0.07 s.

### 3.11 GET /llm-calls?includeSubagents=1

- **Purpose**: per-LLM-call figures: first-token wait p50/p95, decode p50, weighted tokens/s, context and output tokens, cache hit, compactions, retries, subagent calls, error stops; the same by context bucket (8), call index (≤ 40) and model (≤ 50); coverage (runs in the window, runs with a series, `seriesSince`).
- **Called by**: LLM tab (P1); agent tool `view=llm`.
- **SQL** (3 statements in parallel; the first two with `SET LOCAL work_mem = '64MB'`): `llmCallsSql` (one `jsonb_array_elements(s."llmCalls")` over stats rows with `llmCallCount IS NOT NULL`, then `GROUP BY GROUPING SETS` over scope, model/provider, context bucket, call index, with FILTERed `percentile_cont`); `llmRunsSql` (hashed `SELECT DISTINCT (run, in_scope, model, provider)`, then counts); `llmCoverageSql` (runs from `agent_runs` index-only, `count(llmCallCount)` and the earliest series from `agent_run_stats`, 109 ms at 30d ws).
- **Columns**: `agent_run_stats` **`llmCalls`** (JSONB, about 520 B per run with a series), `llmCallCount`, window columns; `agent_runs` covering for the run count.
- **Plan**: 30d ws calls: Parallel Seq Scan of `agent_run_stats`, Function Scan, in-memory sorts, GroupAggregate (4 sets), 38k runs / about 300k calls, 0.9 to 1.4 s. 30d xyne: agent index, 7.3k runs / about 57k calls, 0.18 to 0.32 s.
- **Time**: Θ(R) + Θ(R·C) expansions + O(R·C log(R·C)) sort for the grouping sets and percentiles; **the sort of about 300k rows dominates**. **Space**: DB about 15 MB per worker in-memory sort (ceiling = sort nodes × (workers + 1) × 64 MB); response about 5.2 KB.
- **Bench**: 30d ws cold 0.83 to 1.23 s, warm 3 to 19 ms, 5,228 B; 30d xyne 0.24 to 0.29 s; 7d ws 0.23 to 0.24 s.
- **Caveats**: the heaviest card of the page cold. Percentiles are exact; bucketed first-token histograms (the tool-latency approach) would remove the sort if R grows. The series exists only for runs finished since the recorder shipped and cannot be backfilled, so `coverage` and `seriesSince` are shown beside every figure.

### 3.12 GET /sessions?kind=tool|failed|slow|model&…&limit=&cursor=&count=1

- **Purpose**: the sessions behind a number: rows linking to the run or chat with why each matched. 4 kinds, keyset paging, a total capped at 1,000 on page 1, redaction of personal-credential runs.
- **Called by**: `SessionsList` (tool drawer with `signal` = calls, errors, recovered, unrecovered, dropped, duplicates, empty, cited or notFound plus optional `errorClass`; failed, slow and model drill-downs; Overview "Slowest runs" `kind=slow&limit=10`), which prefetches the next page on intent; legacy `slowSessions` (limit 20, cached per viewer); agent tool `find_metric_sessions`.
- **SQL** (up to 3 in parallel; `runAnalytics` with `customPlan: true`, 3 s timeout): **page** = a `MATERIALIZED` CTE of at most `limit + 1` ids with the kind's filter, cursor predicate and `ORDER BY`, then detail joins (`agent_runs` pkey, `users` pkey, the run's tool row by primary key, top 3 tools by time for slow, per-model series from `agent_run_stats` for model). Tool kinds page over `agent_run_tool_stats` (`tool = $t AND <signal column> > 0`; unrecovered is `errors > recovered`; an error class is `errorClasses @> '[{"class": …}]'`), newest first by (`completedAt`, `runId`); other kinds page over `agent_runs`. **count** (page 1, `count=1`): `SELECT 1 … LIMIT 1001`. **coverage**: `fetchToolStatsCoverage`.
- **Columns**: `agent_run_tool_stats` window keys, `tool`, signal columns, `errorClasses` (detail rows only); `agent_runs` window columns, `left(task, 160)`, `left(error, 300)`, `conversationId`, `channelId`, `usedUserToken`; `users` (`name`, `email`); `agent_run_stats` `llmCalls` (model kind only). `toolInvocations` is never read.
- **Plans** (30d ws): tool `post_document` errored: `(orgId, tool, completedAt)` walked newest first, 26 pkey probes, 36 ms; `search-tools` called (9,608 rows): stops after 26 matches, 28 ms; rare recovered tool (1 row): reads the tool's whole range, 8 ms; failed/slow/model: index-only walks of `agent_runs_metrics_window_idx`, 1 to 107 ms.
- **Time**: tool kinds O(log N + P/ρ_t) ordered walk (worst case the tool's M_w rows); slow Θ(R_o) index-only per page; details O(P × (log N + k + C)); count O(min(M_w, 1001)). **Space**: DB O(P) top-N; response O(P), about 650 B per row.
- **Bench** (cold / uncached repeat): tool `post_document` errors 0.12 to 0.23 s / 31 ms (16,457 B); recovered, 30d xyne 0.02 to 0.05 s / 26 ms; `search-tools` called 0.03 to 0.06 s / 31 ms; rare recovered 0.04 s / 31 ms (980 B); slow limit 10 0.04 to 0.05 s / 36 ms (7,992 B).
- **Caveats**: never cached on the server (the client caches each cursor page for 60 s). `kind=slow` re-scans the window for every page because the keyset is on a computed wall time.

### 3.13 GET /global (legacy shape)

- **Purpose**: the workspace rollup shape `apps/dashboard` (`useClawMetrics`) reads: `totals`, `delta`, `perDay`, `byTrigger`, `topAgents`, `byProvider`, `slowSessions`, `headline`. The v3 page no longer calls it.
- **SQL**: none of its own; it composes cached blocks: `summary` first (§3.1), then at most 3 in flight: `runs/daily` (tz from `?tz=`, default UTC), `agents/top` limit 20, `routes`, and `legacy/slow-sessions` (`/sessions kind=slow`, limit 20, plus coverage; cached per viewer because redaction depends on the viewer).
- **Time**: Θ(R_o + R'_o) for summary + 4 × Θ(R_o) + O(R log R) sorts + O(20 × (log N + k)) for slow-session details. No JSONB and no blob is read. **Space**: O(D + A + routes + 20).
- **Bench**: 30d ws cold 0.16 to 0.27 s, warm 3 ms, 22,628 B (`slowSessions` 7.8 KB, `perDay` 7.8 KB, `topAgents` 4.4 KB); 7d ws 50 to 100 ms, 16,272 B.
- **Notes**: after a v3 Overview load in the same minute it costs only the per-viewer slow-session block, plus the daily block when `tz` differs (v3 sends the browser zone, `/global` defaults to UTC). Run time is end-to-end wall clock, as in v3, and the previous window also applies the orphan exclusion.

### 3.14 GET /agent/:slug (legacy shape)

- **Purpose**: the `/global` rollup for one agent plus `toolLatency`, `sentiment` and memory recall (for `apps/dashboard`).
- **SQL**: composed blocks `summary`, `runs/daily`, `legacy/slow-sessions`, `tools/rollup` (top 30 tools by total time) and `sentiment`, at most 3 in flight (§3.1, §3.2, §3.12, §3.7, §3.6 at the `xyne` scope). Cold it is dominated by `sentiment` (heap read plus regex) and the tool rollup.
- **Space**: O(D + 20 + 30 + 12). **Bench** 30d xyne: cold 0.36 to 0.57 s, warm 4 to 7 ms, 21,790 B (`slowSessions` 7.9 KB, `perDay` 5.5 KB, `toolLatency` 5.1 KB, `sentiment` 1.9 KB).

### 3.15 GET /agent/:slug/improvements, POST /improvements/:id/apply|dismiss, POST /improvements/backfill

- **Purpose**: FailureCurator improvement candidates for one agent: list, apply, dismiss, and re-run the curator. Called by Overview "Improvement suggestions" (single agent only).
- **SQL**: list = `agent.findFirst(slug, orgId)`, `isClawAdmin`, `agentShare.findUnique` for a non-admin non-owner, then `agentImprovementCandidate.findMany(orgId, agentSlug, status = 'pending') ORDER BY confidence DESC, updatedAt DESC LIMIT 100`. Apply/dismiss = `findUnique(id)`, the same authorisation, one `update`. Backfill runs the curator over N days (LLM-bound, minutes, synchronous, not measured).
- **Indexes**: `agents` unique `(slug, orgId)`; `agent_improvement_candidates_agentSlug_status_updatedAt_idx`.
- **Time**: O(log) lookups + O(I_a log I_a). **Space**: O(100) rows. **Bench**: tables empty, cold 10 to 30 ms, warm 2 to 3 ms, 36 B.
- **Notes**: not cached and not routed through `runAnalytics` (no statement timeout, JIT at server default). Needs `x-org-id` (400 without it).

### 3.16 GET /awakening, GET /awakening/:agentId/runs

- **Purpose**: activity of agents that wake on their own: totals, per day, per agent and kind, skip reasons, current state; the second endpoint pages one agent's wake history. Called by Overview "Awakened agents" and row expansion.
- **SQL**: `/awakening` = 5 plain raw SQL statements in parallel (totals; per day; per agent `LEFT JOIN agents LIMIT 50`; skip reasons `LIMIT 20`; states `LEFT JOIN agents LIMIT 100`). Runs = a page `LEFT JOIN agent_runs ON sessionId` with `ORDER BY startedAt DESC LIMIT/OFFSET` and a `COUNT(*)`. No timeout, no cache.
- **Tables / indexes**: `agent_awakening_runs` (`agent_awakening_runs_orgId_startedAt_idx`, `agent_awakening_runs_agentId_windowStartMs_idx` prefix only), `agent_awakening_state` (`_orgId_idx`), `agents`, `agent_runs` (`agent_runs_sessionId_key`).
- **Time**: /awakening 4 × Θ(W) + O(W log W); runs O(W_a + offset + P log N) + Θ(W_a) count. **Space**: /awakening ≤ 15 KB; runs O(P), about 0.4 KB per row.
- **Bench**: tables empty, so scale cost not measured: /awakening cold 29 to 40 ms, warm 7 ms, 153 B; runs 5 to 8 ms. Estimate: 50 agents waking every 15 minutes for 30 days is 144k rows, about 30 ms per index range scan.
- **Notes**: window end is `new Date()` (not floored) and these endpoints keep offset paging.

### 3.17 POST /tools/backfill (CLAW_ADMIN)

- **Purpose**: write `agent_run_stats` and `agent_run_tool_stats` rows for finished runs that lack them (every run that finished before the tables existed). `force: true` rewrites every row in range, which a change to the summary shape needs. Parameters include `maxRows` and optionally `sinceDays`; the response reports `remaining` and `failed`.
- **How it is driven**:
  - The admin **Run backfill** button on the Tools, Quality and Coverage tabs calls this endpoint repeatedly with `maxRows` 5000 until `remaining` is 0, shows "N left" while it runs, and shares one running state across the three tabs.
  - If a slice makes no progress it stops early and shows "Stopped with N left".
  - An admin can still call the API directly in slices of any `maxRows`. Calls are idempotent and resumable, and each stays well under a gateway timeout.
- **SQL**: batches of `agentRun.findMany` with `id > cursor`, finished, not orphaned and `stats: { is: null }` (Prisma compiles it to a `LEFT JOIN agent_run_stats … IS NULL` anti-join), `ORDER BY id LIMIT n`, then `summarizeRun` in Node and `persistRunStats` (§4.1) per batch; finally one `agentRun.count` of runs still missing a row.
- **Columns**: `agent_runs` `toolInvocations`, `result`, `toolsUsed`, `metadata->'citationReflection'->>'outcome'`, run keys; writes both stats tables.
- **Failures**: a failed batch is retried row by row. A row that fails on its own data (SQLSTATE class 22 or 23) is written as an empty summary so the walk never stalls. Any other failure (timeout, pool, connection) leaves the row missing and counted in `failed`, so the next call retries it.
- **Time**: O(N) primary-key walk per full pass (an anti-join probe of the stats pkey per run) + O(B) per run with invocations (a run without invocations gets an empty summary, as finalize writes one). **Space**: O(1) response, about 150 B.
- **Measured** (local database): 969 runs with `force` in 1.1 s (546 with tools, 2,059 tool rows, 403 errored calls); one missed run 157 ms; nothing to do 15 ms. Prod has about 200k runs, i.e. about 40 slices of 5000.

## 4. Write path and backfill

### 4.1 Finalize (`agentRunRepository.finalize`)

The run's own transaction is the same as on `main` apart from the metadata merge. Under the per-session advisory lock it flushes the streamed invocations, reads the run row, merges the streamed and final invocation lists, and updates the `agent_runs` row (status, result, timings, tokens, `toolInvocations`, model) and commits. It writes no metric columns.

**After the commit**, `recordRunStats` writes the metrics rows:
- **Not on the run's path**: it runs outside the run's transaction and lock in its own short transaction; a failure is logged (`event: agent_run_stats_failed`), never thrown.
- `summarizeRun(merged invocations, answer)`: one O(T) pass in memory.
- `persistRunStats` (`lib/tool-stats.ts`, shared with the backfill):
  - `createManyAndReturn` with `skipDuplicates` (`INSERT … ON CONFLICT DO NOTHING RETURNING "runId"`) into `agent_run_stats`: run keys, `toolCalls`, `toolErrors`, `toolNames`, `llmCalls` (capped at 200 calls), `llmCallCount`, `citationOutcome`. A run that already has a row gets an `updateMany` guarded by `completedAt <= new`, so an older write never replaces a newer one (two finalizes of one session can land out of order); a write without a series or outcome leaves the stored one.
  - only for runs inserted or updated: `deleteMany` and `createMany` of their `agent_run_tool_stats` rows, so re-summarising is idempotent.
  - an orphan-closed run gets no rows; deleting its stats row cascades to its tool rows.
- **Shutdown**: `main.ts` waits (bounded) for in-flight metrics writes before exiting. A write lost anyway (a crash) leaves the run without stats rows, which the backfill repairs.

Cost per run: O(T) in memory after the commit; one stats row (about 420 B, 3 indexes) and k tool rows (about 256 B each, 3 indexes) in one short transaction.

**Verified live** (local database, isolated claw-auth): a finished chat's stats row and 3 tool rows appeared right after; with a trigger making `agent_run_tool_stats` reject every insert, a chat still completed with its answer and 4 tool calls saved (the stats write rolled back, logged one warning, left no rows); the next backfill wrote the missed run's rows.

### 4.2 Streamed invocation flushes

While a run streams, claw-auth rewrites `agent_runs.toolInvocations` up to every 2 s per session. This change does not touch that path, and no index it adds references `toolInvocations` or any column a flush changes, so flushes stay HOT-eligible.

### 4.3 Backfill

See §3.17 for the endpoint and the UI loop. It shares `persistRunStats` with finalize, so backfilled and fresh rows cannot diverge: on the local database, `force` over all 969 runs from their raw invocations reproduced every tool row (2,059) and run row (967) of the converted bench data, field for field. After a backfill, `invalidateMetricsCache` and the client `invalidateMetrics` refresh what is on screen.

### 4.4 LLM call series

Claw reports the per-call series (TTFT, decode ms, token buckets, model, compaction and retry flags) with the finish callback, stored as-is in `agent_run_stats.llmCalls` (first 200 calls). Runs finished before the recorder shipped have no series and it cannot be rebuilt, so the LLM tab always shows how many runs in the window carry one.

## 5. Caching

### 5.1 Server: `cachedMetric` (`lib/metrics-core.ts`)

| Aspect | Behaviour |
|---|---|
| Unit | One block per endpoint, scope and params, shared across endpoints: `summary` serves `/summary`, `/global`, `/agent/:slug` and the agent tool; `tools/rollup` serves `/tools`, `/tools/citations`, `/agent/:slug` and the agent tool. |
| Key | `metrics:v2:<gen>:<endpoint>:<orgId\|all\|none>:<userId\|admin>:<agents sorted>:<windowColumn>:<startMs>-<endMs>:<params as sorted JSON>`. The window end is floored to the minute, so all viewers of a scope within a minute share one entry. |
| TTL | 60 s for every block; `/agents/active` 5 min; exact citations 10 min. |
| Layers | (1) per-process LRU, 500 entries; (2) in-flight single-flight per process; (3) Redis read-through and write-behind (`SET … PX ttl`, fire and forget), only when the shared ioredis client is already `ready` (`cachedMetric` never opens Redis itself; the bench is LRU-only). |
| Redis cost when live | One `MGET` of the 2 generation counters on every call (even an LRU hit), plus one `GET` on an LRU miss. |
| Cross-pod dedupe | Only through Redis and only after the first pod has written; concurrent cold misses on different pods each compute. |
| Invalidation | `invalidateMetricsCache(orgId?)` bumps generations locally and with Redis `INCR`; old keys expire by TTL, no SCAN. Called by the backfill. |
| Failure policy | Redis errors are logged and ignored. A failed `compute` (timeout, server error) is remembered in-process for 15 s and re-thrown to every caller of that key. 4xx (e.g. the exact-citation gate) is never remembered; failures are never written to Redis. |
| HTTP | Cached GETs send `Cache-Control: private, max-age=30`; `window.cached` says whether this call computed. |
| Not cached | `/sessions` (cursor pages), `/awakening*`, `/agent/:slug/improvements`, POSTs. Legacy slow sessions are cached per viewer alias set. |
| Memory | Rollup about 40 KB, most blocks under 15 KB; worst case 500 × 40 KB ≈ 20 MB per process. |
| Staleness | Up to about 60 s behind, plus compute time. |

### 5.2 Client: `metricsCache` (`frontend/src/v3/hooks/useDeepMetrics.ts`)

| Aspect | Behaviour |
|---|---|
| Key | `${userId} ${exact URL}`, built through `metricsUrl(path, scope, params)`. |
| Freshness | 60 s; fresh data is served from memory with no request. |
| Dedupe | One in-flight request per key, shared by every card asking for the same URL. |
| Keep previous | While a new key loads, cards keep the old data dimmed. |
| Abort | When the last subscriber unmounts, aborted one tick later (StrictMode and remounts re-acquire in the same commit). |
| Prefetch | `SessionsList` warms the next cursor page on pointer/focus intent. |
| Invalidation | `invalidateMetrics(prefix?)` after a backfill marks entries stale, refetches those on screen, drops idle ones. |
| Bound | 300 entries; idle entries evicted oldest first. |

## 6. Client loading plan

P0 paints first, then P1 (the tab's first cards), then P2 (`LazyCard`, mounted within 200 px of the viewport), then P3 (on open). Every tab carries P0, shared through the client cache.

| Tab | P0 | P1 | P2 (lazy) | P3 (on interaction) |
|---|---|---|---|---|
| every tab | `/summary` (headline); the `/agents?scope=all` roster (not a metrics endpoint); `/agents/active` only once the picker is opened | | | |
| Overview | | `/runs/daily`, shared by 4 cards | workspace: `/agents/top?limit=20`. One agent: `/sentiment`, `/agent/:slug/improvements`, `/tools?limit=5`. Both: `/routes`, `/sessions?kind=slow&limit=10`, `/awakening` | session drawers: `/sessions?kind=failed\|slow\|model…` |
| Tools | | `/tools?sort=errors&dir=desc&limit=25`, `/tools/error-classes?limit=6&perTool=2` | drawer failure modes: `/tools/error-classes?tool=&limit=10` | drawer: `/sessions?kind=tool&tool=&signal=&count=1` (next page prefetched on intent); `/tools?search=<tool>` only when the tool is off the loaded page |
| LLM | | `/llm-calls` (`&includeSubagents=1` behind the toggle) | | model rows: `/sessions?kind=model…` |
| Quality | | `/tools?sort=duplicates&dir=desc&limit=25`, `/tools/citations` | | `exact=1` behind the toggle, only with an agent filter or `days <= 7` |
| Coverage | | `/tools/unused-grants` | | |

**Measured first paint per tab** (30d ws). All of a tab's P0 and P1 requests (Overview also its eager P2 cards) fired in parallel in a fresh minute, so every block was cold. Two rounds, load average 3.1 to 5.3:

| Tab | Wall (all done) | Slowest request | Bytes |
|---|---|---|---|
| Overview | 0.35 / 0.44 s | `/agents/top` | 29 KB |
| Tools | 1.08 / 0.45 s | `/tools` | 28 KB |
| LLM | 1.10 / 0.98 s | `/llm-calls` | 6 KB |
| Quality | 0.60 / 0.64 s | `/tools/citations` (shares the in-flight rollup with `/tools`) | 29 KB |
| Coverage | 0.45 / 0.39 s | `/tools/unused-grants` | 5 KB |

Why it is cheap: one request per card and identical URLs collapse; the headline never waits for a tab's heavy card; a revisit within 60 s costs 0 requests and a later one is answered from the server's 60 s block in 2 to 10 ms; sort, page and search on the Tools and Quality tables re-slice the cached rollup instead of re-running SQL.

## 7. Before vs after

"Before" is the pre-change perf report, run on the same bench earlier the same day. "After" is the final design in this document. 30-day workspace unless noted.

### 7.1 Per need, over HTTP

| What the page needs | Before | After (cold / warm) |
|---|---|---|
| Headline KPIs | `/global?days=30`: 11.97 / 5.59 / 5.20 s (read `toolStats` twice per row) | `/summary`: 0.33 to 0.37 s / 4 to 5 ms |
| `/global?days=30` (apps/dashboard) | 11.97 / 5.59 / 5.20 s, 23.7 KB | 0.16 to 0.27 s / 3 ms, 22.6 KB |
| `/agent/xyne?days=30` (apps/dashboard) | 3.40 / 1.00 / 0.88 s | 0.36 to 0.57 s / 4 to 7 ms |
| Agent picker | a full `/global?days=30` on every load (4.2 to 12 s) | `/agents/active`, only when the picker opens: 23 to 36 ms |
| Tools tab | `/tools`: 500 after 15 s, 3 of 3 | first paint 0.45 to 1.08 s, `/tools` 3 to 13 ms warm |
| Failure modes | inside `/tools`: 24 to 32 s; `/tools/failures`: 500 after 15 s | `/tools/error-classes`: 0.07 to 0.09 s card, 0.02 to 0.03 s one tool |
| Quality tab | `/tools/quality`: 3.82 / 3.30 / 2.76 s; `exact=1`: 500 | first paint 0.60 to 0.64 s; `exact` 3.9 to 5.7 s where allowed, 400 at 30d ws |
| Coverage tab | `/tools/coverage`: 3.64 / 1.98 / 1.74 s, 38 KB | first paint 0.39 to 0.45 s, 5 KB |
| LLM tab | `/llm-calls`: 1.88 / 2.09 / 2.26 s; `points=1` returned 1.84 MB | first paint 0.98 to 1.10 s; `/llm-calls` 0.83 to 1.23 s cold, 5.2 KB (points removed) |
| Overview cards | the same `/global`: 8 sequential heap scans | first paint 0.35 to 0.44 s (`/runs/daily`, `/agents/top`, `/routes`, `/sessions?kind=slow` run in parallel) |

### 7.2 Per statement, `EXPLAIN ANALYZE`

| Statement | Before | After |
|---|---|---|
| headline (current window) | 2,909 to 6,679 ms | `runSummarySql` 72 to 153 ms, index-only |
| perDay, topAgents, byProvider, byTrigger, totals, prev (8 sequential scans) | 143 to 206 ms warm each, 0.7 to 0.8 s cold, summed | `runDailySql` 78 to 116, `routeTableSql` 37 to 39 ms; index-only, at most 3 in parallel |
| slowSessions (read `task` and `toolInvocations`) | 200 to 300 ms | `/sessions kind=slow`: 12 to 107 ms, index-only top-N |
| tool aggregate (materialised CTE, 118 MB spill) | 2,036 to 4,667 ms | `toolRollupSql` 1.02 s with cold reads, about 0.4 s cached, no spill |
| error classes (unnest of `toolInvocations`) | 24,205 ms | 82 ms, from `agent_run_tool_stats` |
| LLM cards (4 scans) | 4 × 0.6 to 1.5 s | 1 scan 0.9 to 1.4 s (plus runs and 109 ms coverage) |
| exact cite rates | 53 to 54 s at 30d ws | 400 at 30d ws; 3.9 to 4.3 s at 30d xyne; 4.8 to 5.7 s at 7d ws |

### 7.3 Cost of the final design

| | Value |
|---|---|
| Disk at 200k runs | 580 MB (two stats tables) |
| Objects Prisma cannot express | 2 (the `agent_runs` covering index, the autovacuum setting) |
| Prod index builds by hand | 1, on `agent_runs` (§8.1) |
| Streamed invocation flushes | HOT-eligible (§4.2) |
| Stats write | after the run's commit, never fails a run |
| Leaderboard | 210 to 260 ms (the stats table has no covering index) |

## 8. Operational notes

### 8.1 Before deploy: build the one big index by hand

`agent_runs` is written on every run, and a plain `CREATE INDEX` holds a SHARE lock that blocks those writes for the whole build. Build the covering index first, outside a transaction:

```sql
-- CONCURRENTLY waits for older transactions instead of blocking writes.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "agent_runs_metrics_window_idx" ON "agent_runs" ("orgId", "completedAt")
  INCLUDE ("id", "status", "agentSlug", "userId", "triggerSource", "startedAt", "parentSessionId", "totalMs",
           "llmTotalMs", "llmDecodeMs", "llmWaitMs", "toolMs", "ttftMs", "tokensPerSec", "tokensIn", "tokensOut",
           "tokensCacheRead", "tokensCacheWrite", "llmTurns", "llmRetries", "provider", "model", "rating")
  WHERE ("error" IS NULL OR "error" <> 'interrupted (orphaned run)');
-- A failed CONCURRENTLY build leaves an INVALID index.
SELECT x.indisvalid FROM pg_index x JOIN pg_class c ON c.oid = x.indexrelid WHERE c.relname = 'agent_runs_metrics_window_idx';
-- If false: DROP INDEX CONCURRENTLY "agent_runs_metrics_window_idx"; and build it again.
```

What the migration then does on deploy (tested on a fresh copy of `main`'s schema, with the index pre-built, and with an INVALID pre-built index):

| Step | Lock on `agent_runs` | Cost |
|---|---|---|
| `SET lock_timeout = '5s'` | | caps every lock wait below |
| create `agent_run_stats`, `agent_run_tool_stats` and their 4 indexes | none | instant (empty) |
| foreign key `agent_run_stats` → `agent_runs` | SHARE ROW EXCLUSIVE: waits for in-flight run writes, and new writes queue behind it | instant once granted. If it waits 5 s the deploy fails without changing anything: `prisma migrate resolve --rolled-back 20261015120000_agent_run_tool_and_llm_stats`, then deploy again |
| covering index | none when it exists: the migration checks the catalog (`to_regclass`) instead of `CREATE INDEX IF NOT EXISTS`, which waits for writers even when the index exists | creates it only where missing (a fresh database); stops the deploy with a clear error if the pre-built one is INVALID |
| `ALTER TABLE agent_runs SET (autovacuum_*_scale_factor = 0.02)` | SHARE UPDATE EXCLUSIVE, does not wait for writes | instant |

`prisma migrate diff` from `main`'s schema plus this migration to the branch `schema.prisma` is empty.

After deploy, a CLAW_ADMIN clicks **Run backfill** on the Tools, Quality or Coverage tab. It calls `POST /claw/api/v1/metrics/tools/backfill` with `maxRows` 5000 until `remaining` is 0 (showing "N left", or "Stopped with N left" if a slice makes no progress; §3.17). The API can also be called directly in slices. Until the backfill finishes, tool, LLM and coverage figures cover only runs finished after the deploy, and the coverage banners say so.

Sizes at 200k runs: `agent_runs_metrics_window_idx` 41 MB (about 205 B per row); `agent_run_stats` 81 MB heap + 29 MB indexes (about 550 B per run); `agent_run_tool_stats` 300 MB heap + 169 MB indexes (about 2.3 KB per run, 5.9 rows per run).

### 8.2 Not expressible in Prisma

The partial covering index `agent_runs_metrics_window_idx` (`INCLUDE` plus `WHERE`, created by the migration's catalog check) and the autovacuum settings on `agent_runs`. Prisma ignores both, so `prisma migrate diff` stays empty. Both tables, their 4 indexes and 2 foreign keys are generated from `schema.prisma`.

### 8.3 Autovacuum and the visibility map

- Every run-level card is an index-only scan of `agent_runs_metrics_window_idx`, heap-free only while the visibility map is fresh (the vacuumed bench shows 0 to 1 heap fetches per 45k entries).
- The migration sets `autovacuum_vacuum_scale_factor` and `autovacuum_vacuum_insert_scale_factor` to 0.02 on `agent_runs` (about 2% of the table, against the default 20%, about 40k runs on a 200k-run table).
- The stats tables keep the defaults: their reads use plain indexes and the heap, not the visibility map.

### 8.4 Statement timeouts, JIT, `work_mem`

| Path | `statement_timeout` | JIT | `work_mem` |
|---|---|---|---|
| `runAnalytics` (every v2 read) | 8 s | off | default |
| `/llm-calls` (calls and runs statements) | 8 s | off | 64 MB (capped at 128) |
| exact citations | 15 s | off | default |
| `/sessions` | 3 s, `force_custom_plan` | off | default |
| `/awakening*`, `/agent/:slug/improvements`, `grantServers`, the backfill | none (plain Prisma) | server default | default |

A timeout surfaces as HTTP 500 with Postgres 57014 and is remembered for 15 s per cache key. `work_mem` is per sort or hash node per process; one cold `/llm-calls` can reserve on the order of 2 × 3 × 64 MB in the worst case.

### 8.5 Connections and fan-out

- Each `runAnalytics` call holds one pooled connection for its whole duration (one `set_config` round trip plus the query); handlers keep at most 3 in flight, so a cold tab first paint holds up to about 6 connections for under 1.5 s.
- Single-flight collapses identical keys within a process; different scopes and minutes do not collapse.
- Check prod's Prisma `connection_limit` against the expected concurrent cold dashboards: the pool is shared with the live run path.

### 8.6 Known costs left

| Endpoint or path | Evidence | Next step if it matters |
|---|---|---|
| exact citations (opt-in) | 3.9 to 5.7 s cold: regex over every answer in the window, then the cited runs' invocation blobs | background job, or store cited call ids at finalize |
| `GET /llm-calls`, 30d workspace | 0.8 to 1.2 s cold: exact percentiles over about 300k calls | bucketed first-token histograms, as tool latency uses |
| `GET /sentiment` (one agent) | about 0.9 s cold at 30d xyne: regex over `agent_runs.result` | write an "apologetic reply" flag at finalize into `agent_run_stats` |
| `GET /tools`, 30d workspace, first read after a restart | 1.8 s: 256k tool rows from disk (scattered on the bench) | none at prod's time-ordered heap |
| `kind=slow` paging | each page re-scans the window (index-only); cursor on a computed expression | fine at prod scale today |
| `get_agent_runs` (existing agent tool, not part of this change) | returned org-wide aggregates and sample tasks to a non-admin in the E2E test, where `get_agent_metrics` correctly returned own runs only | apply the same own-runs scope rule |

### 8.7 What to watch after deploy

- **Latency and errors per metrics route**: p50/p95 and the 500 rate (Postgres 57014). Heavy ones: `/llm-calls`, `/tools`, `/tools/citations`, `/sentiment`.
- **Metrics writes**: the `agent_run_stats_failed` log event. Each is a run without stats rows, which the next backfill writes.
- **Backfill**: `remaining` and `failed` from `POST /tools/backfill`, or `SELECT count(*) FROM agent_runs r WHERE r."completedAt" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM agent_run_stats s WHERE s."runId" = r.id)`.
- **Cache effectiveness**: share of responses with `window.cached = true`; whether Redis is `ready` on each pod.
- **Index-only health on `agent_runs`**: `relallvisible / relpages` near 1; `Heap Fetches` near 0 in `EXPLAIN` of `runSummarySql`.
- **Growth**: about 2.9 KB of stats per run (one run row, about 6 tool rows). Both tables are pruned through `ON DELETE CASCADE` when runs are deleted.
- **When to revisit the design**: a 30-day window above about 250k runs, a 90-day range, or `/llm-calls` p95 above 3 s. Daily rollup tables are then the next step.
