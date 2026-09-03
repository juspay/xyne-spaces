# @xyne/spaces-sdk

TypeScript SDK for Xyne Spaces. **483 methods across 25 resources** — every read
and write the Spaces product itself performs — plus Xyne Claw remote agents.

Zero runtime dependencies. Runs in Node 18+ and in the browser.

```typescript
import { createClient } from '@xyne/spaces-sdk';

const sdk = createClient({
  baseUrl: 'https://spaces.example.com',
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
catalog** — the same 523 queries and mutators the Spaces application runs against
— and proves it on every build:

```
catalog:  275 queries, 248 mutators (523 total)
exposed:  461
excluded: 62
accounted for: 523/523
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

The SDK authenticates with your existing Spaces session. Every request is sent
with `credentials: 'include'`, so the session cookie travels automatically and
there is no option to set:

```typescript
const sdk = createClient({
  baseUrl: 'https://spaces.example.com',
});
```

This is why the browser is the SDK's native home: it is the context that holds
the session. A headless process has no cookie jar, and must supply the session
token itself:

```typescript
const sdk = createClient({ baseUrl, apiKey: token });
// or later: sdk.setApiKey(token)
```

`apiKey` is sent as `Authorization: Bearer <token>`.

This means the SDK acts as the currently logged-in user with exactly their
permissions. Access is decided by the same per-table ACL the product runs behind.

### Identity

```typescript
const me = await sdk.users.me();
// { id, email, name, displayName, workspaceId, orgId, memberId, role, orgRole }
```

This is a request, not a local decode: `role` and `orgRole` are read from the
database on every server-side request rather than carried in the credential, so
this call is the only way to get a full picture.

A few operations take the acting user's id as an argument rather than inferring
it. Pass `me.id`:

```typescript
await sdk.dashboards.upsert({ name: 'Ops', createdBy: me.id });
```

---

## Resources

| Resource | Methods | | Resource | Methods |
|---|---|---|---|---|
| `sdk.tickets` | 46 | | `sdk.userGroups` | 20 |
| `sdk.channels` | 41 | | `sdk.preferences` | 19 |
| `sdk.canvases` | 40 | | `sdk.collections` | 15 |
| `sdk.messages` | 35 | | `sdk.forms` | 15 |
| `sdk.admin` | 31 | | `sdk.activities` | 14 |
| `sdk.email` | 26 | | `sdk.automations` | 13 |
| `sdk.calls` | 25 | | `sdk.projects` | 13 |
| `sdk.boards` | 24 | | `sdk.recaps` | 10 |
| `sdk.incidents` | 24 | | `sdk.dashboards` | 8 |
| `sdk.workspace` | 24 | | `sdk.supportTickets` | 6 |
| `sdk.conversations` | 21 | | `sdk.users` | 5 |
| `sdk.claw` | 4 | | `sdk.search` | 2 |
| `sdk.attachments` | 2 | | | |

Every method carries a description, a documented parameter list, an example, and
a concrete return type — no method returns `unknown`. Hover any of them in your
IDE.

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

The API speaks **five codes, one per status**, so the class you catch already
tells you what happened:

```typescript
import { AuthError, NotFoundError, SdkError } from '@xyne/spaces-sdk';

try {
  await sdk.tickets.update(ticketId, { statusV2: 'COMPLETED' });
} catch (err) {
  if (err instanceof AuthError) {
    // 401. Missing, expired, or revoked — the server does not distinguish.
    // Mint a new key; retrying will not help.
  } else if (err instanceof NotFoundError) {
    // 404. Gone, or not visible to this key. The API is not an existence oracle.
  } else if (err instanceof SdkError && err.code === 'validation_error') {
    // 400. Bad arguments, or a business rule refused it.
    // err.message is written for a person — show it.
  } else if (err instanceof SdkError && err.code === 'forbidden') {
    // 403. The key's user cannot reach this.
  } else if (err instanceof SdkError && err.code === 'api_error') {
    // 500. Logged server-side against the request id; the message is generic.
  }
}
```

| Status | Class / `code` | `serverCode` |
|---|---|---|
| 400 | `SdkError`, `code: 'validation_error'` | `validation_failed` |
| 401 | `AuthError` | `unauthenticated` |
| 403 | `SdkError`, `code: 'forbidden'` | `forbidden` |
| 404 | `NotFoundError` | `not_found` |
| 500 | `SdkError`, `code: 'api_error'` | `internal` |

`serverCode` carries the API's own vocabulary. It is absent for failures that
never reached the server, where `code` is `network_error` or `timeout` — which is
the main thing it is still useful for telling apart.

**400 is the one whose message matters.** A business rule that refuses a write
("Ticket not found", "You are not a participant of this channel") arrives as a
400 with that text intact, because a caller can act on it. 5xx messages are
replaced server-side with a generic string, so nothing there is worth showing.

`RateLimitError` is still exported but nothing throws it: this API has no rate
limiter yet. Do not build a retry strategy around it.

Every response carries an `X-Request-Id`, echoed into error bodies — quote it in
support requests.

---

## Verified completeness

The claim at the top of this file — every read and write the product performs —
is checked on every build of the Spaces repo, by two gates that fail rather than
warn.

The first proves the surface is **complete**: every operation the product can
perform is either reachable through a typed method here, or recorded as
deliberately withheld with a written reason. A new backend operation fails that
build until someone decides which. Completeness is a gate, not a claim.

The second proves the two sides **agree**: that every argument this SDK sends is
one the server accepts, that required arguments are always supplied, that
enumerated values match exactly, that a method returning `T | null` sits on an
operation that really returns one row, and that all 73 entity interfaces name
real database columns.

None of that is something TypeScript can check on its own, because operations
cross the wire as strings. Both gates run in the repo that builds this package,
against the live server source — so a mismatch is caught before a release, not by
you at runtime.

---

## Architecture

### A client over a versioned API

The SDK targets **`/api/sdk/v1`**, hard-coded and not configurable. A given
release speaks exactly one version of the server contract; upgrading the API
means upgrading this package, which is what stops an installed client breaking
when the server gains a v2.

Each operation is declared once in `src/registry/` as an id and a pair of types,
and surfaced by a method in `src/resources/`:

```typescript
// registry/channels.ts — the id and the types
join: op<{ channelId: string }, void>('channels.join', 'mutator'),

// resources/channels.ts — what you call
join(channelId: string): Promise<void> {
  return this.call(channelsOperations.join, { channelId });
}
```

What `channels.join` actually runs, and how its arguments are shaped, is decided
**server-side** — in the backend's `api/sdk/v1/mapper.ts` and `parser.ts`. The
request carries the SDK's own operation id and nothing about the backend:

```
POST /api/sdk/v1/mutate   { "op": "channels.join", "args": { "channelId": "…" } }
```

That split is what makes the surface versioned rather than coupled. The server
can retarget an id onto a renamed or re-versioned operation, and every published
copy of this package keeps working. It also means the plumbing those operations
require — participant ids, mapping ids, timestamps — is generated on the server,
so those values come from the server clock rather than the caller's.

A handful of operations are versioned REST routes instead — search, uploads,
server-side allocation, identity, and Claw — reached at `/api/sdk/v1/…`. Which
transport an operation uses does not change the method you call.

### Keeping the two sides honest

The SDK cannot import the server's schemas: it ships with zero runtime
dependencies and must load in a browser, while those schemas depend on zod. The
agreement is enforced at build time instead, by reading the server's source.

That gate exists because its absence cost real bugs. The SDK once sent `sortBy`,
`sortOrder`, and `channelId` — none of which the server accepts. The calls did
not fail; the parameters were simply dropped, so sorting looked unimplemented
when the correct `orderBy` had shipped all along. A silent no-op is the worst
shape this failure could take, and nothing was comparing the two sides.

Unknown search parameters are now **rejected** with a `validation_failed` 400
naming the offending key, so a typo surfaces at the call rather than as absent
behaviour. The gate still matters: a schema can only reject what is sent, and
the original bug was the SDK sending the wrong name in the first place.

---

## Development

```bash
npm run build      # compile to dist/
npm run typecheck  # tsc --noEmit, strict
npm test           # vitest
```

The two conformance gates live in the Spaces repo rather than here, because they
read the server's source and cannot run from an installed copy of this package.
From the repo root: `pnpm run sdk:verify`.

The SDK is browser-safe by construction: it imports no Node built-ins and
declares no runtime dependencies. Both are checked — a stray `node:fs` import or a
new dependency is a visible change to `package.json`, not a silent one.
