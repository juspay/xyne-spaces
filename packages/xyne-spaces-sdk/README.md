# @xyne/spaces-sdk

TypeScript SDK for Xyne Spaces. **472 methods across 25 resources** — every read
and write the Spaces product itself performs — plus Xyne Claw remote agents.

Zero runtime dependencies. Runs in Node 18+ and in the browser.

```typescript
import { createClient } from '@xyne/spaces-sdk';

const sdk = createClient({
  baseUrl: 'https://spaces.example.com',
  apiKey: process.env.XYNE_SPACES_API_KEY,
});

const me = await sdk.users.me();
const channels = await sdk.channels.list();

const { id: channelId } = await sdk.channels.create({
  scopeType: 'DEFAULT',
  projectId: 'project-1',
  name: 'Deployments',
});

const { conversationId } = await sdk.conversations.create({
  channelId,
  content: 'Deploy is green.',
});

await sdk.messages.send({ conversationId, content: 'Ship it.' });
```

---

## Why this exists

Most product SDKs expose a hand-picked subset of an API and grow a backlog of
"can you add an endpoint for…". This one exposes the **entire operation
catalog** — the same 508 queries and mutators the Spaces application runs against
— and proves it on every build:

```
catalog:  263 queries, 245 mutators (508 total)
exposed:  451
excluded: 57
accounted for: 508/508
```

A new backend operation **fails the build** until someone decides to expose it or
exclude it with a written reason. Completeness is a gate, not a claim.

---

## Install

```bash
pnpm add @xyne/spaces-sdk
```

Node 18+ or any modern browser. No runtime dependencies — nothing is pulled into
your bundle, and there are no transitive supply-chain surprises.

---

## Authentication

The SDK authenticates with an API key:

```http
Authorization: Bearer xyne_sk_…
```

Create one from **Apps → API Keys** in the Spaces dashboard. You will see the key
once; store it in your secret manager and pass it in:

```typescript
const sdk = createClient({
  // The Spaces origin. The SDK adds /api/sdk itself.
  baseUrl: process.env.XYNE_SPACES_BASE_URL,
  apiKey: process.env.XYNE_SPACES_API_KEY,
});
```

Rotating without recreating the client:

```typescript
sdk.setApiKey(next);      // e.g. after fetching a rotated key
sdk.clearApiKey();        // subsequent calls throw AuthError
sdk.hasApiKey();          // whether one is set (not whether it is valid)
```

### What a key can do

A key **acts as the person who created it**, with exactly their permissions, in
exactly their workspace. It is not a service account and grants no elevation.
Access is decided by the same per-table ACL the product runs behind, so a key
cannot read a channel its owner cannot read.

Four properties worth knowing before you deploy:

| | |
|---|---|
| **Short-lived** | 30, 60, or 90 days, chosen at creation. There is no refresh step |
| **Revocable immediately** | Revoking a key in the dashboard stops it on its very next request. The server checks the key's stored status on every call, not just its signature |
| **Live permissions** | Role changes take effect on the next request, not on rotation. Deactivate a user and their keys stop working |
| **Single workspace** | Access to a second workspace requires a second key, minted there |

A user may hold **2 live keys** at a time — enough to rotate without downtime.
Neither an expired nor a revoked key occupies a slot.

### Identity

```typescript
const me = await sdk.users.me();
// { id, email, name, displayName, workspaceId, orgId, memberId,
//   role, orgRole, keyExpiresAt }
```

This is a request, not a local decode: a key's claims don't include `role` or
`orgRole` — those are read fresh from the database on every server-side
request, deliberately, so this call is the only way to get a full picture.
Cache it — the identity behind a key does not change.

`keyExpiresAt` is ISO 8601. Long-running services should check it at startup and
rotate ahead of time rather than discovering the expiry mid-request:

```typescript
const daysLeft = (Date.parse(me.keyExpiresAt) - Date.now()) / 86_400_000;
if (daysLeft < 5) logger.warn('Spaces API key expires soon', { daysLeft });
```

A few operations take the acting user's id as an argument rather than inferring
it. Pass `me.id`:

```typescript
await sdk.dashboards.upsert({ name: 'Ops', createdBy: me.id });
```

---

## Resources

| Resource | Methods | | Resource | Methods |
|---|---|---|---|---|
| `sdk.tickets` | 45 | | `sdk.userGroups` | 20 |
| `sdk.channels` | 41 | | `sdk.workspace` | 20 |
| `sdk.canvases` | 40 | | `sdk.preferences` | 19 |
| `sdk.messages` | 34 | | `sdk.forms` | 15 |
| `sdk.admin` | 31 | | `sdk.activities` | 14 |
| `sdk.email` | 26 | | `sdk.automations` | 13 |
| `sdk.calls` | 25 | | `sdk.projects` | 13 |
| `sdk.incidents` | 24 | | `sdk.collections` | 11 |
| `sdk.boards` | 23 | | `sdk.recaps` | 10 |
| `sdk.conversations` | 21 | | `sdk.dashboards` | 8 |
| `sdk.supportTickets` | 6 | | `sdk.users` | 5 |
| `sdk.claw` | 4 | | `sdk.search` | 2 |
| `sdk.attachments` | 2 | | | |

Every method is typed, documented in-editor, and maps to exactly one backend
operation. Hover any of them in your IDE for the mapping and its caveats.

---

## Working with it

Things that are easy to get wrong, gathered here so you don't have to discover
them.

**Channels contain threads, threads contain messages.**
`sdk.conversations.create` starts a thread; `sdk.messages.send` replies into one.
Reaching for `messages.send` to start a conversation is the most common early
mistake.

**Ids come back from creates.** You never construct them:

```typescript
const { conversationId, messageId } = await sdk.conversations.create({ ... });
const { id: channelId } = await sdk.channels.create({ ... });
const { id: ticketId } = await sdk.tickets.create({ ... });
```

You also never see the participant ids, mapping ids, or timestamps the underlying
operations require — the SDK generates them.

**File bytes use a different transport, transparently.** Pass browser `File`
objects directly, or `{ file: blob, filename: 'report.pdf' }` in Node:

```typescript
const uploaded = await sdk.attachments.uploadDraft({ channelId, files: [reportFile] });

await sdk.messages.send({
  conversationId,
  content: 'Report attached.',
  attachmentIds: uploaded.uploadedAttachments
    .filter((item) => item.success)
    .map((item) => item.attachmentId),
});
```

**Some updates replace rather than patch.** These take the *complete* collection
and delete anything you leave out — read the current set first:

- `sdk.boards.update({ stages })`
- `sdk.boards.updateFlowPlan({ nodes })`
- `sdk.boards.syncTransitions()`
- `sdk.forms.update({ fields })`
- `sdk.recaps.saveSubscriptions()`

**Some operations toggle rather than set.** `channels.toggleStarred`,
`conversations.togglePin`, and `canvases.toggleStarred` flip the current value.
Read state first if you need a specific outcome.

**Seven methods return a `Page<T>`, not an array.** `messages.listByConversation`,
`messages.listByChannel`, `channels.listBrowsable`, `tickets.listByProject`,
`tickets.listActivities`, `users.list`, and `users.listBasic` sit on Zero queries
that have no server-side cursor — the operation returns every matching row in one
response. Rather than hand back an unbounded array, those methods window it:

```typescript
const page = await sdk.messages.listByConversation(conversationId);
page.items;       // the rows — at most 100
page.total;       // how many the underlying result held
page.hasMore;     // whether anything sits beyond this page
page.nextOffset;  // pass as `offset` to get the next one

const next = await sdk.messages.listByConversation(conversationId, {
  offset: page.nextOffset,
});
```

`limit` defaults to 100 and **100 is a hard cap** — a larger value is clamped, not
rejected, since it is a request for how much to return rather than a claim about the
data. `DEFAULT_LIMIT` and `MAX_LIMIT` are exported; prefer them over a literal `100`.

Two things to know before you build on this. The windowing is **client-side**, so it
does not make the request cheaper — the full result still crosses the wire each call,
and looping to collect everything re-fetches it every time. And every other list
method returns a plain array; this is exactly these seven, not a general convention.
Where a real server-side cursor exists — `tickets.list`, `messages.listByUser`,
`activities.listPaginated` — prefer it.

**Search filters are plural; result types are singular.** `SearchOptions.type`
takes `'messages'`, `'tickets'`, …; `SearchResult.type` returns `'message'`,
`'ticket'`, …. Feeding a result type back as a filter fails with
`validation_failed`. Both are literal unions, so TypeScript catches it — but the
vocabularies genuinely differ, so translate deliberately.

**For "the latest N", use `orderBy: 'newest'`** — the default is relevance, which
cannot be paged through time reliably.

**Reading someone's history: use `messages.listByUser`, not search.** Search ranks
by relevance and has a practical offset ceiling, so a thin page cannot be told
apart from a truncated one. `listByUser` orders by `createdAt` and cursors
cleanly:

```typescript
let cursor: MessageCursor | undefined;
for (;;) {
  const page = await sdk.messages.listByUser({ userId, limit: 100, start: cursor });
  const last = page[page.length - 1];
  if (page.length < 100 || !last) break;
  cursor = { messageId: last.messageId, createdAt: last.createdAt };
}
```

**Support tickets are read-only here.** `sdk.supportTickets` is the desk view of
the same rows `sdk.tickets` writes — reassigning or restaging goes through
`sdk.tickets`.

**Collaborative canvases.** When a canvas has `isCollaborative` set, a realtime
server owns its content and `canvases.update` is not a safe read-modify-write.
Save a version first.

**`conversations.getMyParticipation` returns your own row**, not every
participant — the underlying query is scoped to the caller. The catalog has no
all-participants query for threads. (`sdk.channels.listParticipants` *is* a real
list, for channels.)

---

## Claw: remote agents

`sdk.claw` dispatches tasks to Xyne Claw agents. It is relayed through Spaces, so
it needs **no separate credential** — your API key is the only one involved.

```typescript
const agents = await sdk.claw.listAgents();

const run = await sdk.claw.runAndWait({
  agent: 'ask-ai',
  task: 'Summarise what happened in #deployments today',
  timeoutMs: 120_000,
});

console.log(run.status, run.result);
```

Or dispatch and poll yourself:

```typescript
const { sessionId } = await sdk.claw.run({ agent: 'ask-ai', task: '…' });
const run = await sdk.claw.getRun(sessionId);
```

Passing `channelId` makes the agent post its reply into that Spaces thread as
well as returning it — the one place the two systems meet:

```typescript
await sdk.claw.run({ agent: 'ask-ai', task: 'Draft a status update', channelId });
```

`runAndWait` backs off gently and gives up after `timeoutMs` (default 5 minutes).
A timeout stops the *waiting*, not the run — the error names the `sessionId` so
you can keep polling with `getRun`.

---

## Errors

Typed classes for shape, a stable `serverCode` for specifics:

```typescript
import { AuthError, NotFoundError, RateLimitError, SdkError } from '@xyne/spaces-sdk';

try {
  await sdk.tickets.update({ ticketId, status: 'COMPLETED' });
} catch (err) {
  if (err instanceof NotFoundError) {
    // Gone, or not visible to this key. The API is not an existence oracle.
  } else if (err instanceof RateLimitError) {
    await wait(err.retryAfter);
  } else if (err instanceof AuthError && err.serverCode === 'token_expired') {
    // The key ran out. Mint a new one; retrying will not help.
  } else if (err instanceof SdkError && err.serverCode === 'domain_rule') {
    // A business rule rejected it — err.message is meant to be shown.
  }
}
```

`serverCode` is one of the 12 codes defined by
[`@xyne/spaces-contract`](../xyne-spaces-contract): `validation_failed`,
`invalid_request`, `unauthenticated`, `token_expired`, `forbidden`, `not_found`,
`conflict`, `domain_rule`, `rate_limited`, `internal`, `service_misconfigured`,
`upstream_unavailable`. It is absent for purely local failures, where `code` is
`network_error` or `timeout`.

Every response carries an `X-Request-Id`, echoed into error bodies — quote it in
support requests.

---

## Verified completeness

Two build-time gates, both of which fail the build rather than warn:

```bash
npm run coverage         # every catalog operation is exposed or excluded, with a reason
npm run contract-check   # the SDK and the backend agree on names, values, and shapes
```

`coverage` verifies, across all 508 operations, that: the operation exists; every
required argument is supplied; no undeclared argument is sent; enumerated values
match exactly; and a query's single-row-vs-list shape matches the declared return
type. None of that is something TypeScript can check, because the registries
reference operations by string.

`contract-check` compares search parameters and their enumerated values against
the contract, entity interfaces against real database columns, and the error codes
the SDK branches on against the ones the contract defines.

Of the 57 exclusions: 45 are superseded versions (`…V1` where `…V3` is exposed),
10 are the SDLC subsystem (internal, driven by its own services), and 2 are
backend-deprecated or scoped entirely to the caller's own id.

Operations outside the catalog — creating channels and tickets, uploading files,
search — are direct API calls. See [GAPS.md](./GAPS.md).

---

## Architecture

Each operation is declared once in `src/registry/` and surfaced by a method in
`src/resources/`:

```typescript
// registry/channels.ts — what it maps to
join: mutator<{ channelId: string }, void>('channel.joinChannel', {
  mapArgs: (args) => ({
    channelId: args.channelId,
    channelParticipantId: newId(),   // the plumbing callers never see
    channelUserStatusId: newId(),
    timestamp: now(),
  }),
}),

// resources/channels.ts — what you call
join(channelId: string): Promise<void> {
  return this.call(channelsOperations.join, { channelId });
}
```

Operations route to one of two transports, chosen per operation and invisible to
callers: the **catalog** (`/api/sdk/catalog/{query,mutate}`) for anything backed
by a Zero operation, and **direct API** calls for everything else — search,
uploads, server-side allocation, identity, and Claw. Moving an operation between
transports does not change the method you call.

### The shared contract

[`@xyne/spaces-contract`](../xyne-spaces-contract) holds what this SDK and the
backend must agree on: the error catalog and the search request schema.

The SDK does **not** import it at runtime — the contract depends on zod, and this
package ships with none. The agreement is enforced at build time instead.

That gate exists because its absence cost real bugs. The SDK once sent `sortBy`,
`sortOrder`, and `channelId`, none of which the server accepts; because unknown
query parameters are *rejected* rather than ignored, every call that set one
failed, and sorting looked missing when it had shipped all along. The contract had
the correct `orderBy` the whole time — nothing was comparing the two.

---

## Development

```bash
npm run build           # compile to dist/
npm run typecheck       # tsc --noEmit, strict
npm run coverage        # catalog coverage gate
npm run contract-check  # conformance with @xyne/spaces-contract
npm test                # vitest
npm run verify          # typecheck + coverage + contract-check
```

The SDK is browser-safe by construction: it imports no Node built-ins and
declares no runtime dependencies. Both are checked — a stray `node:fs` import or a
new dependency is a visible change to `package.json`, not a silent one.
