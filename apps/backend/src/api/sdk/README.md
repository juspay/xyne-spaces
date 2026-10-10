# `/api/sdk` — the Xyne Spaces public API

The HTTP surface behind [`@xyne/spaces-sdk`](https://www.npmjs.com/package/@xyne/spaces-sdk).
It authenticates via session cookies (same as the dashboard), then hands the work
to code the product itself already runs.

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
| `query.ts` | Run one catalog query |
| `mutation.ts` | Run one catalog mutator |
| `direct.ts` | Call the product controllers behind the catalog gaps |
| `handler.ts` | Request id, and the one error envelope |
| `errors.ts` | The error catalog, and `SdkApiError` |
| `schemas/search.ts` | The search request schema |
| `index.ts` | Router assembly |

`v1/` is the half that matters. Everything else is plumbing shared with the
product.

---

## Authentication

The SDK uses cookie-based authentication, reusing the existing Spaces session
(same as the dashboard). This is handled by `authMiddleware.authenticate`.

### Authorization

There is none here beyond identity. The SDK acts as the logged-in user, and
**Zero's per-table ACL** — folded into every query AST and every wrapped
transaction — decides what that user may read and write. It is the same boundary
the app runs behind, which is the point: a second authorization model would be a
second thing to keep correct.

---

## Endpoints

### Service

| | | |
|---|---|---|
| `GET` | `/api/sdk/version` | Build identity. **Unauthenticated** |
| `GET` | `/api/sdk/health` | Read availability. **Unauthenticated** |

Both are mounted *before* the auth middleware on purpose, so a probe can tell
"the API is misconfigured" from "your session is bad".

### v1

| | | |
|---|---|---|
| `POST` | `/api/sdk/v1/query` | `{ op, args }` → `{ data }` |
| `POST` | `/api/sdk/v1/mutate` | `{ op, args }` → `{ success: true, generated? }` |

This pair is the bulk of the API: **492 operation ids**, 9 of them retired. `op` is an
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

Two other kinds of id:

- **Retired** — a shipped id whose catalog operation was removed with no faithful
  successor. It answers `404 not_found`, `Operation "<id>" was retired: <reason>`,
  on either endpoint, and the reason says what to use instead.
- **Direct** — an id that resolves to a route below (`calls.initiate`, `calls.join`,
  `calls.leave`). Accepted on either endpoint; the request is re-entered into the
  route with the parsed arguments as its body, and the response is the route's.

Every catalog query and mutator should be mapped here or listed in
`v1/exclusions.json` with a reason. Nothing enforces this automatically, so a
change to the catalog needs a matching change to one of the two.

Retargets that change what an existing id returns:

- `boards.list` (now `getAllBoardsList`) and `boards.listByProject` (now
  `boardsListByProject`) return **board columns only**. The queries they used
  to target also returned each board's stages; fetch those with
  `boards.listStagesForBoards`. `boards.listByProject` and
  `boards.listByProjectLite` now run the same query.
- `tickets.listByProject` returns **one page** of the project's non-archived
  tickets (`tableTicketsPage`), newest first: `limit` rows after the optional
  `start` cursor. It used to return the whole project. `limit` is capped at 500
  (as is `tickets.listTable`'s); read further with `start`, the last row's
  `{ id, createdAt }`.

### Direct

Versioned REST routes for what is not a catalog entry — server-side allocation,
multipart uploads, search, and identity:

| | |
|---|---|
| `GET /api/sdk/v1/me` | Who the session acts as |
| `POST /api/sdk/v1/channels` | Create a channel |
| `POST /api/sdk/v1/channels/check-duplicate` | Name availability |
| `POST /api/sdk/v1/tickets` | Create a ticket (sequence allocator) |
| `POST /api/sdk/v1/channels/:channelId/conversations` | Start a thread with attachments |
| `POST /api/sdk/v1/attachments` | Upload entity attachments |
| `POST /api/sdk/v1/draft-attachments` | Upload draft attachments |
| `GET /api/sdk/v1/search` | Vespa search |
| `GET /api/sdk/v1/search/schema` | Field definitions for a search index |
| `POST /api/sdk/v1/calls/initiate` | `{ channelId, callType, invitedUserIds?, conversationId? }` → `{ token, livekitUrl, externalId, callId, roomLink, channelId, scopeType }` or `{ pending: true }` |
| `POST /api/sdk/v1/calls/join` | `{ callId }` (the external id) → `{ token, livekitUrl, externalId, roomLink, channelId, scopeType }` or `{ pending: true }`. Workspace-scoped, as `/api/calls/join` |
| `POST /api/sdk/v1/calls/:callId/leave` | → `{}` (legacy no-op; the media webhook records leaving) |

Responses are the product controller's body without its `success` flag (or its
`{ success, data }` envelope). All run as the caller; the database ACL and tenant
scope apply as they do for the dashboard.

#### Users, DMs, channels, conversations

| | |
|---|---|
| `GET /api/sdk/v1/me/affinity` | → `{ channelWeights, userWeights }` |
| `GET /api/sdk/v1/users/search` | `?q&limit&offset` → `{ data, pagination }`; rows omit `authProvider` and `orgMemberId` |
| `GET /api/sdk/v1/me/dms` | → `{ channels, total }` |
| `POST /api/sdk/v1/me/dms` | `{ participantIds, message?, forwardedMessage?, silent? }` → the DM channel |
| `GET /api/sdk/v1/channels/search` | `?q&limit&types` → `{ results, total, query, limit, types }` (mention search) |
| `POST /api/sdk/v1/channels/member-counts` | `{ channelIds }` → `{ counts }` |
| `GET /api/sdk/v1/channels/:channelId/members` | → `{ members }`; members only |
| `GET /api/sdk/v1/conversations/threads` | `?limit&cursor&sort` → `{ threads, nextCursor, hasMore }` |
| `GET /api/sdk/v1/conversations/recent-visited` | → `{ days, channels }` |
| `GET /api/sdk/v1/conversations/by-message/:messageId` | → the conversation row. 404 unless the caller could read that message (workspace, private-channel membership, `visibleTo`) |

#### Notifications and daily brief

| | |
|---|---|
| `GET /api/sdk/v1/notifications` | `?page&limit&status` (limit ≤ 100) → `{ notifications, pagination }` |
| `GET /api/sdk/v1/notifications/unread-count` | → `{ count }` |
| `GET /api/sdk/v1/notifications/workspace-counts` | → `{ counts }` |
| `PATCH /api/sdk/v1/notifications/mark-all-read` | → `{}` |
| `PATCH /api/sdk/v1/notifications/:id/read` | `{ channelId?, conversationId? }` → `{}` |
| `PATCH /api/sdk/v1/notifications/:id/dismiss` | → `{}` |
| `GET`/`PUT /api/sdk/v1/notifications/preferences` | Per-type `{ browserEnabled, emailEnabled, slackEnabled }`; `PUT` → `{}` |
| `GET /api/sdk/v1/daily-brief/latest` | Today's (or the latest) brief |
| `GET /api/sdk/v1/daily-brief/history` | `?limit` |
| `GET /api/sdk/v1/daily-brief/dates` | `?limit` |
| `GET /api/sdk/v1/daily-brief/by-date/:date` | `:date` is `YYYY-MM-DD` |
| `GET`/`PUT /api/sdk/v1/daily-brief/config` | `{ enabled?, instructions?, instructionsEnabled? }` |
| `GET`/`PUT /api/sdk/v1/daily-brief/settings` | `{ agentSlug }`; the write is org-admin only, enforced by claw-auth |

#### Radar

| | |
|---|---|
| `GET /api/sdk/v1/radar/feed/pending-me` | → `{ threads }` |
| `GET /api/sdk/v1/radar/feed/waiting-on` | → `{ threads }` |
| `GET /api/sdk/v1/radar/feed/pending-others` | `?page&mutedPage&pageSize&holders&channels&createdFrom&createdTo` → a page; without `page`, `{ threads }` |
| `POST /api/sdk/v1/radar/items/:itemId/resolve` | → the action result |
| `POST /api/sdk/v1/radar/items/:itemId/dismiss` | → the action result |
| `GET /api/sdk/v1/radar/rules` | → `{ rules }` |
| `POST /api/sdk/v1/radar/rules` | `{ conditions }` → `{ rule }`; at most `MAX_RULES` |
| `PATCH /api/sdk/v1/radar/rules/:ruleId` | `{ conditions }` → `{ rule }` |
| `DELETE /api/sdk/v1/radar/rules/:ruleId` | → `{ id }` |

#### Emojis, canvases, tickets

| | |
|---|---|
| `GET /api/sdk/v1/emojis` | → the workspace's custom emojis |
| `GET /api/sdk/v1/emojis/:emojiId` | → one emoji |
| `POST /api/sdk/v1/emojis` | Multipart `file` (≤ 256 KB) + `name` → the emoji |
| `DELETE /api/sdk/v1/emojis/:emojiId` | → `{}`; creator only |
| `POST /api/sdk/v1/canvases/create` | `{ title, markdown, visibility?, channelId? }` → `{ id, title, url, visibility, channelId }`; a `channelId` must be one the caller belongs to |
| `POST /api/sdk/v1/canvases/upload` | Multipart `file` + `canvasId`, `width?`, `height?` → `{ attachmentId, fileName, fileSize, mimeType, thumbnailUrl }`; edit access required |
| `GET /api/sdk/v1/canvases/labels` | `?canvasIds` (comma-separated, ≤ 200) → `{ labels: { [canvasId]: Label[] } }` |
| `GET /api/sdk/v1/canvases/labels/suggestions` | `?query&offset&limit` → `{ labels, offset, limit }` |
| `POST /api/sdk/v1/canvases/:canvasId/labels` | `{ names }` → `{ labels }` |
| `POST /api/sdk/v1/canvases/:canvasId/labels/remove` | `{ labelIds }` → `{}` (POST: the product route is a DELETE with a body) |
| `PATCH /api/sdk/v1/tickets/:ticketId` | `{ assigneeId?, stage?, groupId?, title?, description?, priority?, status?, eta?, tags?, formFields? }` → `{ updated }`. Requires the `TICKETS` write grant and a ticket the caller can read in their workspace (404 otherwise) |

#### Desk metrics and desk report

Access is the controllers' own: channel membership, desk owner or channel
admin (guests keep trend-only reads on the two dashboard metrics routes), and
— on the dashboard routes — the desk's `metricsEnabled` preference. Filter
params are JSON-encoded string arrays, as the dashboard sends them.

| | |
|---|---|
| `GET /api/sdk/v1/channels/:channelId/metrics` | `?timeRange&dateBasis&assigneeIds&stageNames&priorities&userGroupIds&tagValues&aiCategories&customFieldKeys&customFieldPerKeyFilters` → `DeskMetricsResponse` (`timeRange` is `startMs_endMs`, ≤ 90 days, default last 7) |
| `GET /api/sdk/v1/desk-metrics/aggregate` | The same filters + `?channelIds` (comma-separated, ≤ 20) → `DeskMetricsAggregateResponse` (`perDesk`, `skipped`) |
| `GET /api/sdk/v1/desk-metrics/desks` | → `{ desks }`, trimmed to desks the caller manages |
| `GET /api/sdk/v1/desk-report/:channelId/latest` | → `{ report, canGenerate }`; `report` is null if none was ever generated |
| `GET /api/sdk/v1/desk-report/:channelId/view` | `?download=1` → the latest completed report as **`text/html`**, not JSON (passed through with the controller's `Content-Type`, `Content-Disposition` and CSP) |
| `POST /api/sdk/v1/desk-report/:channelId/generate` | → `{ started: true }`. **Starts an agent run**; owner / channel admin only. A refusal (run already in flight, no owner, agent not installed, report disabled) is `validation_failed` |
| `GET /api/sdk/v1/claw/desk-metrics/desks` | → `{ desks }` (the agent-facing mount) |
| `POST /api/sdk/v1/claw/desk-metrics/query` | `{ channelIds, timeRange?, lastDays?, metrics?, includeTickets?, customFieldBreakdown?, …filters }` → `DeskMetricsQueryResponse` (`desks`, `skipped`, `perDesk?`, `notes`). No `metricsEnabled` gate |

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

### Connectors

External data through the **viewer's own** claw-auth connection (Pulse, GitHub,
Grafana, …), relayed through Spaces by `clawConnectorsService`:

| | |
|---|---|
| `GET /api/sdk/v1/connectors` | Connectors the viewer can see → `{ connectors }` |
| `GET /api/sdk/v1/connectors/:type/tools` | The connector's tools, write ones flagged → `{ tools }` |
| `POST /api/sdk/v1/connectors/:type/call` | `{ tool, args? }` → `{ content }` (raw MCP text) |
| `POST /api/sdk/v1/connectors/:type/connect` | `{ returnTo? }` → `{ kind: 'oauth', authUrl }` or `{ kind: 'manual', settingsUrl }` |

- **Runs as the viewer.** claw-auth resolves the viewer's personal connection, or
  the org's shared one — never credentials pinned to an agent. The token stays in
  claw-auth; the app only ever sees the tool's output.
- **Read-only.** A write tool is refused with `403 forbidden`,
  `details: { connector, tool, reason: 'write_tool' }`.
- No connection yet is `409 not_connected`, `details: { connector }`; the app can
  call `connect` and open the returned `authUrl` (or send the user to
  `settingsUrl` for connectors set up with a credential form). `connect` is
  limited to 10 per minute per viewer (it can register an OAuth client with the
  provider); past that it is `429 rate_limited`.
- App calls get their own MCP session in claw-auth, never one an agent run
  opened, so an agent's pinned credential can't serve a viewer's call.
- Claw's own plumbing (`xyne-spaces`, `xyne-dashboard`, `xyne-workflows`,
  `xyne-spaces-app-tools`, `heisenberg`, `research-agent-mcp`) is never listed
  and reads as `404`.
- `:type` is the connector's `McpServer.type`, `/^[a-z0-9][a-z0-9_-]{0,63}$/`.
  A tool the connector does not advertise is a `400`.

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
`details`, when present, is a list of `{ path, issue }` for a validation failure,
or a small object for a connector failure (see [Connectors](#connectors)).

**One code per status.** The mapping is total: every failure this API can
produce lands on exactly one of them.

| Code | Status | Retryable | Means |
|---|---|---|---|
| `validation_failed` | 400 | | Bad arguments, **or a business rule refused it** |
| `unauthenticated` | 401 | | Session missing, invalid, or expired |
| `forbidden` | 403 | | The Zero ACL said no |
| `not_found` | 404 | | No such endpoint, operation, or visible resource |
| `not_connected` | 409 | | The viewer has no usable connection for this connector |
| `rate_limited` | 429 | ✓ | Too many connector sign-ins started; wait, then retry |
| `internal` | 500 | ✓ | Everything else |

This replaced a twelve-code vocabulary. Three of those codes had no producer
anywhere in the codebase, `rate_limited` described a limiter that does not
exist, and `retry_after_seconds` was declared, read, and never once set — so
callers were branching on distinctions the server could not actually make.
`not_connected` (409) and `rate_limited` (429, now backed by a real limiter on
connector `connect`) were added later, each with its own status. Adding a
code means adding a status; two failures that share a status
share a code and differ in `message`.

Three behaviours worth knowing:

- **5xx messages are replaced** with a generic string, so SQL and connection
  detail never reach a caller. The cause is in the call log, under the `request_id`.
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
so a retry chain can be correlated. It is the same id the app-wide request logger
stamps on every log line, so the `request_id` from an error envelope finds the
whole request in the logs: auth, the call log, and anything the mutator logged.

### The call log

`callLog` in `handler.ts` writes one `[sdk] call` line per request, when the
response finishes: info for 2xx/3xx, warn for 4xx, error for 5xx (with the
cause). It is the only error log this API writes.

```jsonc
{
  "requestId": "…",          // = X-Request-Id
  "userId": "…", "workspaceId": "…",
  "op": "messages.send",     // SDK operation id, or "GET /search" for a path-addressed route
  "kind": "mutator",         // query | mutator | direct | unknown
  "method": "POST", "path": "/api/sdk/v1/mutate",
  "status": 200, "code": null, "durationMs": 84
}
```

Every field comes from the server, never from a header a caller can set, and
bodies are never logged: arguments and results carry message text, emails and
ticket content. A request rejected before an operation resolves (failed auth,
unknown path) still gets a line, without `op`; a client that hangs up first is
logged as `499` with `aborted: true`. Device-flow sign-in (`/api/sdk/auth/sso`)
is mounted ahead of this router and is not in the call log.

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

A route may declare `query` and `body` schemas (the controller receives the parsed
values, so unaccepted fields are stripped) and `guards`, which run first and
restate protection the product route gets from somewhere that does not apply
under `/api/sdk` — a URL-keyed ACL, or nothing.

---

## Configuration

| Variable | Default | Meaning |
|---|---|---|
| `SDK_API_ENABLED` | `false` | Master switch. The router is not mounted when false |
| `DATABASE_READ_REPLICA_POOL_URL` | — | Where reads go. Required in production; outside it, falls back to the primary pool |
| `JWT_SECRET` | — | Signs and verifies session tokens. Already required by the app |

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
reachable, plus one in `v1/parser.ts` if its arguments need shaping. If it is
deliberately not exposed, list it in `v1/exclusions.json` with a written reason
instead. Nothing checks this automatically, so keep the two in step by hand.

`v1/exclusions.json` is the other half of `v1/mapper.ts`: between them they
partition the catalog, and every operation must be in exactly one. An entry
carries a reason from a fixed grammar —
`superseded-by:<name> | legacy-unused | internal | deferred:<why>` — so "not
exposed" is always a recorded decision rather than an omission. It is
**per-version**: it states what *this* version does not reach, so a `v2/` starts
from a copy and shrinks as it exposes more.

It lives here rather than in the SDK because it names catalog operations. Shipping
it inside the published package would hand every consumer a list of internal
operation names and the reasons each is withheld — which is the opposite of what
the versioned surface is for.

**A new direct route** is one entry in `ROUTES` in `direct.ts`, backed by either a
`controller` (writes an Express response, gets captured) or a `service` (returns a
value). Never both — the type enforces it.

**Changing the error envelope** means `handler.ts` and `errors.ts` together,
and the SDK's `core/errors.ts` by hand: nothing checks that the two agree, so a
code or a search parameter changed here needs a matching SDK change.

**A breaking change to the surface** is what `v2/` is for. Retargeting an
existing id onto a different catalog operation is fine and needs no new version;
changing what an id *means* to a caller is not.
