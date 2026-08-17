# agent-automations

Self-proposed, event-driven **agent wakeups**. An agent proposes an automation
("when a comment is added to PR #123, wake me on this thread and continue"); a
human approves it; a **generic signed webhook** then wakes the agent **inside the
original conversation** each time a matching external event arrives.

The module is complete end-to-end: the agent-facing `propose-automation` tool,
the authed approve/list/revoke/rotate management API, the validated + secured +
idempotent public ingress, optional per-source signature verification, run
records, dispatch on the existing `/internal/run` contract, and a Prisma
migration. It is additive — no existing behavior changes.

## Why a new module (not the xyne-spaces automation engine)

xyne-spaces' automation engine lives in the Spaces backend and is coupled to
Spaces triggers/steps/Zero mutators. Agent wakeups belong to the claw runtime's
trust domain (agent slug, org, S2S run dispatch, thread continuation). So we
**copy the proven generic-webhook pattern** from xyne-spaces rather than reuse
its engine.

## What we copied from xyne-spaces (generic external `WEBHOOK` trigger)

Ported 1:1 in shape (file references are xyne-spaces
`apps/backend/src/automations/`):

| Property | xyne-spaces | here |
|---|---|---|
| URL **is** identity | `POST {base}/:seriesId/:secret` (`routes/webhook-trigger.handler.ts`) | `POST …/agent-automations/hooks/:automationId/:secret` |
| Encrypted rotatable secret, issued once | `services/webhook-secret.service.ts` | `agent-automations/secret.ts` (AES-256-GCM via `crypto.ts`) |
| Timing-safe secret compare | ✔ | `storedSecretMatches` (length-check + `timingSafeEqual`) |
| Generic declared `bodySchema` / `headerSchema` | `triggers/webhook.trigger.ts`, `engine/declared-schema.ts` | `agent-automations/declared-schema.ts` (verbatim port) |
| Schema mismatch → 400 | `assertMatchesSchema` | same |
| Drops `authorization`/`cookie` headers | ✔ | `STRIPPED_HEADERS` |
| Async accept (202), heavy work off request path | ✔ | ✔ |
| Service-actor scope off tenant | `workspaceId` | `orgId` |

## The three deliberate divergences

1. **Runs continue the ORIGINAL `conversationId`.** A scheduled job mints a
   fresh `scheduled_<id>_<ts>` session; an agent-automation dispatches into the
   thread the agent proposed on, so it resumes with full history. See
   `dispatch.ts` (contract copied from `queue/scheduled-jobs-worker.ts`).
2. **Delivery-id idempotency.** `@@unique([automationId, deliveryId])` is the
   dedup boundary — a retried webhook (GitHub/Stripe retry non-2xx) inserts a
   duplicate run row, loses the race (P2002), and returns `202 duplicate`
   instead of waking the agent twice. This is the single most important addition
   over both xyne-spaces and n8n (n8n has **no** dedup).
3. **Optional `matchPredicate`.** Repo-level webhooks fire for every comment in
   the repo; a flat dot-path predicate (`{"issue.number":123}`) scopes a
   subscription to one resource **before** spending an agent run.

## Ingress decision flow (`routes/agent-automations.ts`)

```
POST /agent-automations/hooks/:automationId/:secret
  findFirst id + status=ACTIVE ............ else 404 (uniform, un-probeable)
  storedSecretMatches(secret) ............. else 401
  assertMatchesSchema(body,  bodySchema) .. else 400
  assertMatchesSchema(hdrs,  headerSchema)  else 400
  verifySignature(source) [optional] ...... else 401
  matchesPredicate(body) .................. else 202 skipped
  expiresAt -> EXPIRED transition ......... else 202 skipped
  maxRuns cap ............................. else 202 skipped
  insert AgentAutomationRun(unique) ....... P2002 -> 202 duplicate
  dispatchAutomationRun() off request path
  202 accepted
```

## Security model

- **The URL secret is the auth.** 32 random bytes, base64url, encrypted at rest,
  timing-safe compared, rotatable, shown once at approval.
- **HITL activation.** `POST /:id/approve` requires an interactive `x-user-id`
  (browser). An S2S/agent call has none, so an agent **cannot self-activate** its
  own proposal.
- **Runs execute as the owning user** (`createdByUserId`), never elevated.
- **Optional per-source signature verification** (`verify.ts`) is a
  defense-in-depth layer ON TOP of the URL secret, selected by `verifySource`.
  Byte-exact HMAC uses `req.rawBody` (captured by `main.ts` before
  `express.json()`), so a real GitHub/Stripe signature actually matches. An
  unknown/misconfigured verifier **fails closed** (401), never opens the
  endpoint. Registered: `github-hmac-sha256`, `hmac-sha256`, `header-token`.
  The substrate stays vendor-agnostic — adding a source is one entry in
  `VERIFIERS`, no route change.

## Owner review / follow-ups

- **`prisma generate` + apply the migration.** The offline build sandbox cannot
  download the Prisma engine, so the generated client's new-field types and the
  migration were authored to the verified `ScheduledJob` convention but not
  machine-applied here. Run `prisma migrate deploy` (or `dev`) locally.
- **Run-loader rehydration.** Confirm `/internal/run` rehydrates a long,
  pre-existing `conversationId` for an event-triggered run (thread-continuity
  assumption — dispatch binds the original thread).
- **Approve / secret-URL UI surface.** The API returns the one-time `webhookUrl`;
  where it is shown (thread card vs dashboard) is a product decision.
- **`AUTH_SERVICE_PUBLIC_URL`** must point at the externally reachable base so the
  issued webhook URL is deliverable from outside the cluster.
- **`EXPIRED` sweeper.** A lazy transition happens at ingress; a periodic sweep
  to expire idle automations that never receive another delivery is nice-to-have.

## Files

| File | Purpose |
|---|---|
| `declared-schema.ts` (+ test) | dependency-free payload shape validation |
| `predicate.ts` (+ test) | optional per-resource scoping |
| `secret.ts` | issue / verify / rotate the URL secret + seal/open signing secret (AES-256-GCM) |
| `verify.ts` (+ test) | pluggable per-source signature verifiers (HMAC / token), fail-closed |
| `dispatch.ts` | fire the run on `/internal/run`, bound to the original thread |
| `../routes/agent-automations.ts` | 3 routers: hooks / management (propose·approve·list·revoke·rotate-secret) / internal callback |
| `../../prisma/schema.prisma` | `AgentAutomation` + `AgentAutomationRun` |
| `../../prisma/migrations/20260818120000_agent_automations/` | create-table migration for both models |
| `packages/xyne-claw-shared/src/tools/agent-automations/` | `propose-automation` agent runtime tool |
