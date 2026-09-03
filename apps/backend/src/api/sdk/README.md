# `/api/sdk` — the Xyne Spaces public API

The HTTP surface behind [`@xyne/spaces-sdk`](../../../../packages/xyne-spaces-sdk).
It authenticates an API key, then hands the work to code the product itself
already runs.

That last point is the design. This directory contains **no business logic** — no
ACL, no search ranking, no sequence allocation, no indexing. Those live in the
Zero catalog and the product controllers, and are reached from here unchanged. A
request through `/api/sdk` and the same action taken in the app converge on the
same function within a few frames of stack.

---

## Layout

| File | Owns |
|---|---|
| `v1/mapper.ts` | SDK operation id → catalog operation or route |
| `v1/parser.ts` | SDK operation id → the arguments its target expects |
| `v1/index.ts` | The versioned router |
| `v1/types.ts` | Shared types for the two above |
| `auth.ts` | Turn a credential into an `AuthData` |
| `query.ts` | Run one catalog query |
| `mutation.ts` | Run one catalog mutator |
| `direct.ts` | Call the product controllers behind the catalog gaps |
| `handler.ts` | Request id, and the one error envelope |
| `errors.ts` | The error catalog, and `SdkApiError` |
| `schemas/search.ts` | The search request schema |
| `config.ts` | Three environment switches |
| `index.ts` | Router assembly |

`v1/` is the half that matters. Everything else is plumbing shared with the
product.

---

## Authentication

Two credentials are accepted, and the server routes on the prefix:

```http
Authorization: Bearer xyne_sk_<jwt>     # API key, minted in the dashboard
Authorization: Bearer xyne_sso_<jwt>    # SSO token, from the device flow
```

Both resolve to the same `AuthData`. They differ in one respect that matters:
an API key has a row in `sdk_api_keys` and can be revoked mid-life; an SSO token
has no row, carries a `jti` nothing currently reads, and is therefore valid until
it expires. Its short lifetime is the containment.

### What an API key is

`xyne_sk_` followed by a JWT, signed with the same `JWT_SECRET` session cookies
use, carrying the caller's **stable** identity:

```ts
{ sub, email, name, workspaceId, orgId, memberId }
```

A distinct `audience` claim (`xyne-sdk`, not `xyne-user`) keeps the two token
kinds from being interchangeable despite sharing a secret — a session token
presented here, or an SDK key presented as a session cookie, fails
`jwt.verify`'s audience check before anything else is inspected.

`role` and `orgRole` are **not** claims — session JWTs never carried them
either. `apiKeyAuth` re-reads both from `users` and `org_members` on every
request, the same way `extractAuthDataFromJWT` does for session callers, so a
demoted or deactivated user loses access on their next request regardless of
what their key still says.

### Where integrity comes from

Two things, and both must hold.

**The signature** proves the key is authentic. `jwt.verify` rejects anything not
signed with `JWT_SECRET` before a single claim is trusted.

**The `sdk_api_keys` row decides whether it is still allowed.** A JWT cannot be
un-issued, so revocation has to live somewhere the server can change after the
fact. `apiKeyAuth` looks the row up by its `token` on every request and refuses
a key whose `status` is not `ACTIVE`, whose `expires_at` has passed, or whose
row is missing entirely. `DELETE /api/sdk-keys/:id` sets `status = 'REVOKED'`
rather than removing the row, so the key stops working on its very next request
and the row survives as the audit trail.

A signature that verifies is therefore necessary but not sufficient. The cost is
one indexed read per request, alongside the two already done for `role` and
`orgRole` — all three issued together, so it is one round trip rather than
three. The benefit is that a leaked key can be killed immediately instead of
being live until its TTL runs out.

### Scoping

A key acts in **one workspace**, and this is structural rather than a policy. A
`User` row is itself workspace-scoped — somebody with access to two workspaces
holds two user rows with different ids — so `sub` already determines the
workspace, and Zero's `Context` carries exactly one. A second workspace needs its
own key, minted from that workspace.

Keys are minted at `POST /api/sdk-keys` (`routes/sdk-keys.ts`), which is
**session**-authenticated: you cannot use an API key to mint another one. A user
may hold **2 live keys**, choosing a lifetime of **30, 60, or 90 days** at
creation. Neither an expired nor a revoked key occupies a slot.

### Authorization

There is none here beyond identity. An API key acts as its user, and **Zero's
per-table ACL** — folded into every query AST and every wrapped transaction —
decides what that user may read and write. It is the same boundary the app runs
behind, which is the point: a second authorization model would be a second thing
to keep correct.

There are deliberately **no OAuth scopes**. The previous design had 21 scope
families and a generated 460-line operation→scope map; it was a parallel
permission system layered over the one that actually guards the rows.

---

## Endpoints

### Service

| | | |
|---|---|---|
| `GET` | `/api/sdk/version` | Build identity. **Unauthenticated** |
| `GET` | `/api/sdk/health` | Read availability. **Unauthenticated** |

Both are mounted *before* the auth middleware on purpose, so a probe can tell
"the API is misconfigured" from "your key is bad".

### v1

| | | |
|---|---|---|
| `POST` | `/api/sdk/v1/query` | `{ op, args }` → `{ data }` |
| `POST` | `/api/sdk/v1/mutate` | `{ op, args }` → `{ success: true, generated? }` |

This pair is the bulk of the API: **468 operations** reachable by id. `op` is an
**SDK operation id** — `tickets.listKanban`, `channels.join` — not the name of a
Zero operation. `v1/mapper.ts` resolves it; `v1/parser.ts` shapes the arguments;
the target's own zod schema validates the result.

That indirection is the point of versioning the surface. A caller never names a
catalog operation, so renaming one, or superseding it with a `…V3`, moves a line
in `mapper.ts` instead of breaking every installed client.

The endpoint must agree with the operation's kind: posting a mutator to `/query`
is a 400, not a silent read, because reads go to the replica pool and writes open
a transaction.

`generated` carries any row id the parser minted — Zero's optimistic-write model
expects the writer to supply primary keys, so v1 mints them server-side and hands
them back rather than making a caller invent them.

### Direct

Versioned REST routes for what is not a catalog entry — server-side allocation,
multipart uploads, search, and identity:

| | |
|---|---|
| `GET /api/sdk/v1/me` | Who the credential acts as, plus `keyExpiresAt` |
| `POST /api/sdk/v1/channels` | Create a channel |
| `POST /api/sdk/v1/channels/check-duplicate` | Name availability |
| `POST /api/sdk/v1/tickets` | Create a ticket (sequence allocator) |
| `POST /api/sdk/v1/channels/:channelId/conversations` | Start a thread with attachments |
| `POST /api/sdk/v1/attachments` | Upload entity attachments |
| `POST /api/sdk/v1/draft-attachments` | Upload draft attachments |
| `GET /api/sdk/v1/search` | Vespa search |
| `GET /api/sdk/v1/search/schema` | Field definitions for a search index |

### Claw

Remote agents, **relayed through Spaces** rather than reached directly:

| | |
|---|---|
| `GET /api/sdk/v1/claw/agents` | Agents this deployment can run |
| `POST /api/sdk/v1/claw/runs` | Dispatch a run → `{ sessionId }` |
| `GET /api/sdk/v1/claw/runs/:sessionId` | Poll status and result |

Claw is a separate service (`apps/xyne-claw-auth`) with its own credential.
Rather than making callers hold two, `clawAgentService` relays with the
deployment's service credential. `runS2SClawAgent` is used rather than
`runClawAgent`: it takes an explicit identity that maps one-to-one onto
`AuthData`, and returns a pollable session id.

---

## Errors

One envelope, from `handler.ts`, the only place a status code is written:

```json
{
  "error": {
    "code": "not_found",
    "message": "No such endpoint: GET /api/sdk/v1/nope",
    "request_id": "req_5f1e3610-a2f7-4d02-bd8b-4718ad9ebe8b",
    "retryable": false
  }
}
```

`code` is the stable field. Branch on it, never on `message`.

**Five codes, one per status.** The mapping is total: every failure this API can
produce lands on exactly one of them.

| Code | Status | Retryable | Means |
|---|---|---|---|
| `validation_failed` | 400 | | Bad arguments, **or a business rule refused it** |
| `unauthenticated` | 401 | | Key missing, malformed, expired, or revoked |
| `forbidden` | 403 | | The Zero ACL said no |
| `not_found` | 404 | | No such endpoint, operation, or visible resource |
| `internal` | 500 | ✓ | Everything else |

This replaced a twelve-code vocabulary. Three of those codes had no producer
anywhere in the codebase, `rate_limited` described a limiter that does not
exist, and `retry_after_seconds` was declared, read, and never once set — so
callers were branching on distinctions the server could not actually make.
Adding a sixth code means adding a status; two failures that share a status
share a code and differ in `message`.

Three behaviours worth knowing:

- **5xx messages are replaced** with a generic string, so SQL and connection
  detail never reach a caller. The cause is logged against the `request_id`.
- **4xx messages pass through verbatim**, and that is the point of routing
  business-rule failures to 400 rather than 500. The mutator catalog raises
  plain `Error`s at ~485 sites carrying genuine user-facing text ("Ticket not
  found"), and a caller can act on those. The cost is that an *unexpected*
  error is echoed too, since the mapping cannot tell them apart — give a new
  domain failure a typed error if its message should not be public.
- **An unknown operation id is a 404**, not a 400 — whether it is missing from
  `v1/mapper.ts` or names a catalog operation that no longer exists. Both are
  tagged before dispatch, so neither can be confused with an operation that ran
  and refused.

`X-Request-Id` is echoed on every response, and a caller-supplied one is honoured
so a retry chain can be correlated.

---

## How a request is served

### Reads

`query.ts` picks the pool and calls `runCatalogQuery` in `zero/server.ts` — the
same function the app's own query fallback uses. The chain is
`mustGetQuery` → `queryDef.fn` → `asQueryInternals` → compile ZQL to SQL →
execute → `conformToZeroShape`.

Because `queryDef.fn` is the real `defineQuery` wrapper, the per-table read ACL is
folded into the AST **before any SQL is generated**. There is no second
authorization path to keep in sync.

Reads go to the replica (`DATABASE_READ_REPLICA_POOL_URL`). In production, a
missing replica makes the API report `degraded` at `/health` and return
`internal` — it is a deployment fault the caller can do nothing about, so the
detail goes to the logs, not the response. Outside production it falls back to
the primary pool, so a local setup with no replica configured still works.

### Writes

`mutation.ts` calls `runCatalogMutation` in `zero/server.ts`, again the same
function the app's mutate fallback uses: `createMutators` →
`wrapTransactionWithACL` → `mustGetMutator` → `mutator.fn`, then the post-commit
drain — awaited tasks, async tasks, Vespa indexing jobs, and side-effect handlers
under a Prisma tenant context.

This sharing is not cosmetic. When the two were separate implementations they
drifted: the SDK's copy omitted the mutator name passed to
`wrapTransactionWithACL`. One call site makes that impossible.

### Direct

`direct.ts` invokes the product controller through a capturing stub — controllers
write their own Express response, so the body is intercepted and re-emitted in
the SDK envelope. The principal is presented on `req.user`, which is where both
the controllers and `tenantScopeMiddleware` read identity from.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SDK_API_ENABLED` | `false` | Master switch. The router is not mounted when false |
| `DATABASE_READ_REPLICA_POOL_URL` | — | Where reads go. Required in production; outside it, falls back to the primary pool |
| `JWT_SECRET` | — | Signs and verifies keys. Already required by the app for session tokens |

No dedicated signing key, no client registry, no callback URLs.

---

## Not implemented, deliberately

| | Why |
|---|---|
| **Rate limiting** | Planned for a later version. A half-kept control is worse than none |
| **Idempotency keys** | Removed with the OAuth surface. Retries are the caller's concern |
| **OAuth / scopes** | The Zero ACL is the authorization boundary; see above |
| **mTLS** | Removed from the SDK. Terminate client certificates at the gateway |

Rate limiting will need its own Redis keyspace when it lands.
`services/zeroRateLimiter` is not suitable: it is a fixed-window counter whose
buckets are shared with zero-cache traffic, so a user browsing the app would
spend their own API budget.

---

## Extending it

**A new Zero query or mutator** needs one entry in `v1/mapper.ts` to be
reachable, plus one in `v1/parser.ts` if its arguments need shaping. The SDK's
`npm run coverage` fails until it is either exposed as a typed method or excluded
with a written reason — and it checks both directions, so a mapper entry no SDK
method calls is an error too. That gate is what makes "complete" verifiable.

**A new direct route** is one entry in `ROUTES` in `direct.ts`, backed by either a
`controller` (writes an Express response, gets captured) or a `service` (returns a
value). Never both — the type enforces it.

**Changing the error envelope** means `handler.ts` and `errors.ts` together.
The SDK's `npm run contract-check` reads `errors.ts` and `schemas/search.ts`
directly, so a code or a search parameter that changes here without the SDK
following fails that build.

**A breaking change to the surface** is what `v2/` is for. Retargeting an
existing id onto a different catalog operation is fine and needs no new version;
changing what an id *means* to a caller is not.
