# agent-automations

Self-proposed, event-driven **agent wakeups**. An agent proposes an automation
("when a comment is added to PR #123, wake me on this thread and continue"); a
human approves it; a **generic signed webhook** then wakes the agent **inside the
original conversation** each time a matching external event arrives.

This is Phase 1: schema + a validated, secured, idempotent public ingress that
records runs and dispatches them on the existing `/internal/run` contract. It is
additive — no existing behavior changes.

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
  matchesPredicate(body) .................. else 202 skipped
  expiresAt / maxRuns caps ................ else 202 skipped
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
- Per-source signature verification (GitHub HMAC etc.) is an **optional**
  defense-in-depth layer keyed off `source`, added later — the substrate stays
  vendor-agnostic.

## Not in Phase 1 (owner review needed)

- The `propose-automation` runtime **tool** (thin wrapper calling `POST
  /agent-automations`) — skeleton only via the HTTP route here.
- Confirmation that the run loader rehydrates a long `conversationId` for an
  event-triggered run (thread-continuity assumption).
- Where the Approve / secret-URL UI is surfaced (thread card vs dashboard).
- Optional pluggable per-source signature verifiers.
- `EXPIRED` sweeper (a lazy check exists at ingress; a periodic sweep is nice-to-have).

## Files

| File | Purpose |
|---|---|
| `declared-schema.ts` (+ test) | dependency-free payload shape validation |
| `predicate.ts` (+ test) | optional per-resource scoping |
| `secret.ts` | issue / verify / rotate the URL secret (AES-256-GCM) |
| `dispatch.ts` | fire the run on `/internal/run`, bound to the original thread |
| `../routes/agent-automations.ts` | 3 routers: hooks / management / internal callback |
| `../../prisma/schema.prisma` | `AgentAutomation` + `AgentAutomationRun` |
