# Plan: Restrict CLAW_ADMIN Access to Within an Org

**Goal:** Today a `CLAW_ADMIN` is a platform-wide superuser — admin endpoints don't filter
queries by the requester's org, and several mechanisms (`?orgScope=all`, client-supplied
`orgId` params, unfiltered queries) let an admin reach data in other orgs. This plan uses a
**two-layer approach** — a middleware chokepoint (systematic) + per-endpoint query fixes
(surgical) — to make every CLAW_ADMIN capability org-scoped. No outside-org access.

---

## 0. Key Design Insight — No Schema Change Needed

A `UserRole` belongs to a user (`userId`). A user belongs to **exactly one org**
(`User.orgId`, NOT NULL — `schema.prisma:79`, "single-org phase 1"). Two users with the same
email in different orgs are **different users** (different IDs, `@@unique([email, orgId])` —
`schema.prisma:83`). When a user joins a new org, `User.orgId` is updated
(`organizations.ts:397`).

Therefore the org is **already implicitly determined** by `userId → User.orgId`. Adding
`orgId` to `UserRole` would be redundant denormalization. `isClawAdmin(userId)` and
`requireClawAdmin` stay as-is — no schema migration, no signature change, no backfill.

The request's org context is always server-derived: `require-auth.ts:34` sets
`req.headers["x-org-id"] = user.orgId`. `getOrgId(req)` reads it. Never trusted from the
client (stripped at `main.ts:147` + `require-auth.ts:58`).

**The problem is endpoints, not the role table.** The fix is at the middleware + query level.

---

## 1. Current State — Cross-Org Access Vectors

### 1.1 The three systematic escape hatches

| Vector | Location | Mechanism |
|---|---|---|
| `?orgScope=all` | `lib/admin-org-scope.ts:12` | `getAdminOrgScope` returns `{allOrgs: true, orgId: undefined}` — drops the org filter. Used by **18 endpoints** across admin.ts, control-center.ts, metrics.ts, agents.ts, chain-workflows.ts. |
| `?scope=all` (agents) | `agents.ts:368` | Variant: `getAdminOrgScope(req, "/agents", admin && wantAllAgents)` — widens agent list to all orgs. |
| Client-supplied `orgId` | `admin.ts:399,465,489,529` | `?orgId=` query param or body `orgId` overrides the admin's own org with an arbitrary one. |

### 1.2 Unfiltered queries (no orgId in the where-clause at all)

| Area | file:line | What leaks cross-org |
|---|---|---|
| **Role management** | `admin.ts:39,62,106` | List/grant/revoke roles for users in any org |
| **MCP/provider credentials** | `admin.ts:336-711` | Read/write/delete any org's credentials; `findUnique({id})` with no org filter |
| **Control-center approvals** | `control-center.ts:437,460` | Approve/reject any org's approval by id (Redis, no org check) |
| **Control-center events** | `control-center.ts:633` | SSE stream, no per-org filter |
| **Memory review queue** | `memory.ts:291,329,344,394,540,697,1290,1620,1740` | List/approve/reject/sweep across all orgs |
| **Metrics backfill** | `metrics.ts:1174` | Backfills across all orgs |
| **Attachment download** | `agent-chat.ts:622` | Admin downloads any org's attachment by id |
| **Conversation list/messages** | `agent-chat.ts:1846,2486` | Admin views any user's conversations across orgs |
| **Experiment stop** | `webhook.ts:1421` | Admin stops any org's experiment |
| **Scheduled-job control** | `scheduled-jobs-auth.ts:33` | Admin bypasses owner check; job lookup may not be org-scoped |

### 1.3 Already org-safe (no change needed)

Agent/skill promote/demote (`agents.ts:1935,1972`, `skills.ts:225,249`) and most memory
mutation routes — they resolve resources via `findBySlug(slug, getOrgId(req))` which fails
closed. The `callable-agent-resolver.ts:326` lookup is also org-safe (resolves `user.orgId`
first). Inline bypasses in `run.ts:840` pass `agent.orgId` to the resolver.

---

## 2. Two-Layer Architecture

| Layer | Where | What | Coverage |
|---|---|---|---|
| **Layer 1: Middleware chokepoint** | `requireClawAdmin` in `agent-acl.ts` | Fail-closed on missing org + strip `?orgScope=all` / `?scope=all` + strip client `orgId` from query & body | All ~30 admin routes at once — kills the systematic escape hatches |
| **Layer 2: Per-endpoint query fixes** | individual route files | Add `orgId: getOrgId(req)` to queries + verify `:id` resources belong to admin's org | The unfiltered queries that middleware can't reach |

Layer 1 is high-leverage — one file, ~15 lines, closes the three systematic vectors across
all routes. Layer 2 is surgical — middleware can't filter DB queries or verify resource
ownership by `:id` (each resource type needs its own lookup: Postgres vs Redis, different
tables, different param names). Both are necessary; together they're defense-in-depth.

---

## 3. Implementation Phases

### Phase 1 — Layer 1: Middleware chokepoint
**File:** `middleware/agent-acl.ts` (the `requireClawAdmin` function, line 123).

Enhance `requireClawAdmin` to do three things after confirming the CLAW_ADMIN role:

1. **Fail-closed on missing org:**
   ```ts
   const orgId = getOrgId(req);
   if (!orgId) {
     res.status(403).json({ success: false, error: "Org context required" });
     return;
   }
   ```

2. **Strip `?orgScope=all` and `?scope=all`** from `req.query` — so `getAdminOrgScope`
   always returns `{allOrgs: false, orgId}` regardless of what the client sends:
   ```ts
   delete req.query["orgScope"];
   delete req.query["scope"];
   ```

3. **Strip client-supplied `orgId`** from `req.query` and `req.body` — so admin endpoints
   can't be directed at an arbitrary org:
   ```ts
   delete req.query["orgId"];
   if (req.body && typeof req.body === "object") delete req.body["orgId"];
   ```

**Why this works:** Every endpoint that calls `getAdminOrgScope(req, ...)` will now get
`{allOrgs: false, orgId: <admin's org>}` because the query param is gone before the handler
runs. Every endpoint that reads `req.query["orgId"]` will get `undefined` and must fall back
to `getOrgId(req)`. This is the single highest-leverage change.

**What it does NOT do:** It doesn't add `orgId` to queries that never had it (memory reviews,
approvals by id, etc.) — that's Layer 2. It also doesn't help routes that don't go through
`requireClawAdmin` but use inline `isClawAdmin()` (agent-chat, webhook) — those need Phase 7.

**Also update `admin-org-scope.ts`** as belt-and-suspenders: change `getAdminOrgScope` to
hardcode `allOrgs = false` (ignore the param even if it somehow arrives). This protects
inline `isClawAdmin` callers that also use `getAdminOrgScope`.

### Phase 2 — Role management (same-org enforcement)
**File:** `admin.ts`.

- `GET /roles` (`:39`): filter `listByRole` results to the requester's org. The `user.include`
  already returns `user.orgId` — filter in-handler: `roles.filter(r => r.user.orgId ===
  getOrgId(req))`.
- `POST /roles` (`:62`): after resolving the target user, **verify
  `targetUser.orgId === getOrgId(req)`** (403 otherwise). This prevents granting roles to
  users in other orgs. The grant itself needs no orgId — the role belongs to the user.
- `DELETE /roles/:userId` (`:106`): fetch target user, verify same org before revoking.

### Phase 3 — MCP servers & provider credentials
**File:** `admin.ts`.

- `GET /mcp-servers` (`:336`): keep platform-global **read** (deployment catalog, not org
  data). OR restrict — decision §8.
- `.../global-credentials` PUT/DELETE/GET (`:396,461,486`): after Phase 1, the client
  `orgId`/`?orgId=` is already stripped. These handlers must now use `getOrgId(req)` instead
  of the (now-deleted) `req.query["orgId"]` / `req.body.orgId`. Verify they fall back
  correctly.
- `GET /provider-credentials` (`:527`): after Phase 1, `req.query["orgId"]` is stripped.
  Ensure the handler falls back to `getOrgId(req)` (it already does: `|| getOrgId(req)`).
- `promote/bind/unbind/adopt/delete` (`:560-711`): replace `findUnique({id})` lookups with
  org-scoped lookups, or verify `agent.orgId === getOrgId(req)` after the fetch; 403 on
  mismatch.

### Phase 4 — Control-center approvals & events
**File:** `control-center.ts`.

- `POST /approvals/:id/approve|reject` (`:437,460`): after fetching the approval, verify its
  owning org matches `getOrgId(req)`. Resolve org from the source run's `AgentRun.orgId`
  (`schema.prisma:1081`). If the approval record in Redis doesn't carry orgId, look up the
  originating run/session. 403 on mismatch.
- `GET /events` (`:633`): filter the SSE stream by org. Requires tagging events with `orgId`
  at publish time (add `orgId` to the published event payload) and dropping non-matching
  events on the consumer side.
- All `getAdminOrgScope` reads (`:191,240,315,364,490,547,590,725`): already fixed by Phase 1
  (the param is stripped). Verify no regressions.

### Phase 5 — Memory review queue
**File:** `memory.ts`.

- `GET /reviews` (`:291`), `approve-all`/`reject-all` (`:344,394`): add `orgId: getOrgId(req)`
  to the `where` clause. (`PendingMemoryReview.orgId` exists — `schema.prisma:1720`.)
- `PATCH /review/:id` (`:329`): fetch review, verify `review.orgId === getOrgId(req)`.
- `POST /batches/:id/approve|reject` (`:1620,1740`): same — verify `batch.orgId`.
  (`PendingBatchReview.orgId` — `schema.prisma:1758`.)
- `POST /banks/:agentSlug/retention-sweep` (`:540`): resolve agent via
  `agentRepository.findBySlug(agentSlug, getOrgId(req))` first (fail-closed), then sweep.
- `GET /memories` (`:697`) & `POST /recall` (`:1290`): when admin uses cross-user mode, verify
  `targetUser.orgId === getOrgId(req)` before allowing the bypass.

### Phase 6 — Metrics backfill
**File:** `metrics.ts`.

- `POST /improvements/backfill` (`:1174`): pass `getOrgId(req)` to `backfillFailureCurator`
  and scope the backfill query by orgId.

### Phase 7 — Inline cross-org bypasses (not behind `requireClawAdmin`)
**Files:** `agent-chat.ts`, `webhook.ts`, `scheduled-jobs-auth.ts`.

These use inline `isClawAdmin()` — Phase 1's middleware doesn't cover them.

- **`agent-chat.ts:622` (attachment download):** after `findById`, verify the attachment's
  org matches `getOrgId(req)`. Resolve via attachment → message → conversation → org, or add
  `orgId` to `ChatAttachment` if the join chain is missing.
- **`agent-chat.ts:1846` (conversation messages):** resolve the conversation's org; 403 if it
  doesn't match `getOrgId(req)` before applying the `allRuns` cross-user view.
- **`agent-chat.ts:2486` (list conversations):** when `?userId=` targets another user, verify
  `targetUser.orgId === getOrgId(req)`.
- **`webhook.ts:1421` (experiment stop):** resolve the run's org (`AgentRun.orgId`); verify
  match before allowing the admin bypass.
- **`scheduled-jobs-auth.ts:33`:** verify the scheduled job's org (`ScheduledJob.orgId` —
  `schema.prisma:1590`) matches `getOrgId(req)` before the admin bypass. Audit callers in
  `scheduled-jobs.ts:122,268,512,552,1079`.

### Phase 8 — Verify router-level mounts & decide on platform-wide ops
**Files:** `main.ts`, gateways/evals/entity-extraction routers.

- `${BASE}/gateways` (`main.ts:172`), `${BASE}/evals` (`:284`), `${BASE}/entity-extraction`
  (`:287`): inherit the enhanced `requireClawAdmin` from Phase 1. Verify each router's
  handlers filter by org (entity-extraction reads a whole run — ensure it's org-scoped).

**Platform-wide operations decision:**
Some CLAW_ADMIN actions are intentionally platform-wide. Options:
1. **Remove from CLAW_ADMIN** (nobody can do it, or deployment engineer does it out-of-band).
2. **New `PLATFORM_ADMIN` role** (just a new string in `GRANTABLE_ROLES` + a
   `requirePlatformAdmin` middleware — no schema change, `UserRole` already stores arbitrary
   role strings).

Affected:
- Platform-wide shared credentials (`agents.ts:3889`, `platform` flag)
- Platform agents (`scope: "platform"`)
- Global MCP catalog & deployment-wide defaults (`orgId = NULL` rows)
- Error-pipeline taxonomy (`/admin/error-pipeline/*`)

**Recommendation:** `PLATFORM_ADMIN` for these only. Keeps org admin's blast radius inside
the org while preserving deployment ops.

### Phase 9 — Testing
- **Middleware:** `?orgScope=all` / `?scope=all` / `?orgId=` / body `orgId` are all stripped
  before the handler runs; missing `x-org-id` → 403.
- **Integration (per fixed endpoint):** admin in org A → 200 on org-A resource, 403/404 on
  org-B resource. Cover: `/admin/roles` grant/revoke/list, `/provider-credentials`,
  `/control-center/approvals/:id/approve`, `/memory/reviews*`, attachment download,
  conversation list/messages, experiment stop, scheduled-job control.
- **Regression:** org-scoped admin operations still work (promote/demote within org, memory
  upload-md/clear-all, metrics views, `?scope=all` agent list now org-only).
- **Fail-closed:** no `x-org-id` → 403, never a global lookup.

---

## 4. Task Dependency Matrix

| Task | Depends on | Files |
|---|---|---|
| **P1 middleware chokepoint** | — | `agent-acl.ts`, `admin-org-scope.ts` |
| P2 role management | P1 | `admin.ts` |
| P3 MCP/provider credentials | P1 | `admin.ts` |
| P4 control-center approvals/events | P1 | `control-center.ts` |
| P5 memory review queue | P1 | `memory.ts` |
| P6 metrics backfill | P1 | `metrics.ts` |
| P7 inline bypasses | — (not behind requireClawAdmin) | `agent-chat.ts`, `webhook.ts`, `scheduled-jobs-auth.ts` |
| P8 router mounts + platform-admin | P1 | `main.ts`, gateways/evals/entity-extraction |
| P9 testing | P1-P8 | tests |

**P1 is the foundation** — all per-endpoint fixes (P2-P6, P8) depend on it because Phase 1
strips the cross-org params systemically. **P7 is independent** (inline `isClawAdmin` callers
don't go through `requireClawAdmin`). After P1 lands, P2-P8 can proceed in parallel (disjoint
files).

---

## 5. Risks & Rollback

- **Stripping `orgId` from `req.body`:** if any admin endpoint legitimately accepts `orgId`
  in the body for a *non-cross-org* purpose (unlikely — verify), stripping it could break
  that flow. Audit body-consuming admin endpoints before Phase 1.
- **`?scope=all` on agents list:** after Phase 1, admins will only see their own org's
  agents in the metrics dropdown. If the UI expects cross-org, update the frontend.
- **Approvals/events org-tagging:** P4 requires orgId on Redis records. If absent today, add
  at publish time — coordinate with whoever writes those records.
- **`ChatAttachment` may lack `orgId`:** P7's attachment fix may need a join chain or a new
  column. Verify schema before implementing.
- **Rollback:** all changes are code-only (no schema migration). Reverting `agent-acl.ts`
  restores the old middleware behavior. P1 is the single highest-impact revert point.
