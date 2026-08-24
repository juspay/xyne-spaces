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

Eight files, five of which are the whole design:

| File | Owns |
|---|---|
| `auth.ts` | Turn an API key into an `AuthData` |
| `query.ts` | Run one catalog query |
| `mutation.ts` | Run one catalog mutator |
| `direct.ts` | Call the product controllers behind the catalog gaps |
| `handler.ts` | Request id, and the one error envelope |
| `errors.ts` | `SdkApiError`, bound to the contract's error catalog |
| `config.ts` | Three environment switches |
| `index.ts` | Router assembly |

Roughly 1,000 lines. It was 3,802 across 26 files when it ran its own OAuth
authorization server.

---

## Authentication

A key is minted from the Apps page in the dashboard and presented as a bearer
token:

```http
Authorization: Bearer xyne_sk_<base64url>
```

### What a key contains

`xyne_sk_` followed by base64url of an AES-256-CBC blob holding the caller's
**stable** identity:

```ts
{ sub, email, name, workspaceId, orgId, memberId }
```

`role` and `orgRole` are deliberately **not** in the blob. They drive the mutator
ACL, so they are re-read from `users` and `org_members` on every request — a
demoted or deactivated user loses access immediately, rather than whenever
somebody remembers to delete their key. Expiry lives on the row for the same
reason: both are facts that can change after the key was handed out.

### Where integrity comes from

**The database row, not the cipher.** `encryptionService` is AES-CBC with no MAC,
so ciphertext is malleable and a successful decrypt proves nothing on its own.
Authentication is the exact-match lookup of the presented key against
`sdk_api_keys.token`, which is `@unique`: a forged or tampered key matches no row
and is rejected before any field inside it is trusted.

That same lookup is the revocation point. Deleting the row disables the key on
its next request.

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

Deleting a key (`DELETE /api/sdk-keys/:id`) is a soft revoke: the row stays,
`status` moves from `ACTIVE` to `REVOKED`, `revokedAt` records when. `apiKeyAuth`
rejects a revoked key with the same message as a row that never existed —
"Unknown or revoked API key" — so revocation carries no information a caller
could use to distinguish the two. `status` is a plain `String` column rather
than a Postgres enum: this repo's enums are frozen (`scripts/validate-no-new-enums.sh`),
so a fixed value set is enforced app-side via `SDK_API_KEY_STATUSES` in `auth.ts`.

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

### Catalog

| | | |
|---|---|---|
| `POST` | `/api/sdk/catalog/query` | `{ name, args }` → `{ data }` |
| `POST` | `/api/sdk/catalog/mutate` | `{ name, args }` → `{ success: true }` |

This pair is the bulk of the API: **508 operations** (263 queries, 245 mutators)
reachable by name. `name` is the Zero operation; `args` is validated by that
operation's own zod schema.

### Direct

Operations that are not Zero catalog entries — server-side allocation, multipart
uploads, search, and identity:

| | |
|---|---|
| `GET /api/sdk/me` | Who the key acts as, plus `keyExpiresAt` |
| `POST /api/sdk/channels` | Create a channel |
| `POST /api/sdk/channels/check-duplicate` | Name availability |
| `POST /api/sdk/tickets` | Create a ticket (sequence allocator) |
| `POST /api/sdk/channels/:channelId/conversations` | Start a thread with attachments |
| `POST /api/sdk/attachments` | Upload entity attachments |
| `POST /api/sdk/draft-attachments` | Upload draft attachments |
| `GET /api/sdk/search` | Vespa search |
| `GET /api/sdk/search/schema` | Field definitions for a search index |

### Claw

Remote agents, **relayed through Spaces** rather than reached directly:

| | |
|---|---|
| `GET /api/sdk/claw/agents` | Agents this deployment can run |
| `POST /api/sdk/claw/runs` | Dispatch a run → `{ sessionId }` |
| `GET /api/sdk/claw/runs/:sessionId` | Poll status and result |

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
    "message": "No such endpoint: GET /api/sdk/nope",
    "request_id": "req_5f1e3610-a2f7-4d02-bd8b-4718ad9ebe8b",
    "retryable": false
  }
}
```

`code` is the stable field. Branch on it, never on `message`.

| Code | Status | Retryable |
|---|---|---|
| `validation_failed` | 400 | |
| `invalid_request` | 400 | |
| `unauthenticated` | 401 | |
| `token_expired` | 401 | |
| `forbidden` | 403 | |
| `not_found` | 404 | |
| `conflict` | 409 | |
| `domain_rule` | 422 | |
| `rate_limited` | 429 | ✓ |
| `internal` | 500 | ✓ |
| `service_misconfigured` | 503 | |
| `upstream_unavailable` | 503 | ✓ |

Two behaviours worth knowing:

- **5xx messages are replaced** with a generic string, so SQL and connection
  detail never reach a caller. The cause is logged against the `request_id`.
- **`domain_rule` messages pass through verbatim.** The mutator catalog raises
  plain `Error`s at ~485 sites carrying genuine user-facing text ("Ticket not
  found"), and those are worth surfacing. The cost is that an *unexpected* error
  is echoed too, since the mapping cannot tell them apart. Give a new domain
  failure a typed error if its message should not be public.

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
`service_misconfigured`; outside production it falls back to the primary pool,
so a local setup with no replica configured still works.

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
| `ENCRYPTION_KEY` | — | 32 bytes, hex. Already required by the app |

No signing keys, no client registry, no callback URLs.

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

**A new Zero query or mutator** needs nothing here. It is reachable through
`/catalog/*` the moment it exists in the registry. The SDK's `npm run coverage`
will fail until it is either exposed as a typed method or excluded with a reason
— that gate is what makes "complete" verifiable.

**A new direct route** is one entry in `ROUTES` in `direct.ts`, backed by either a
`controller` (writes an Express response, gets captured) or a `service` (returns a
value). Never both — the type enforces it.

**Changing the error envelope** means `handler.ts` and the contract, together.
