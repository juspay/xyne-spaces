# @xyne/spaces-sdk

TypeScript SDK for Xyne Spaces. **455 methods across 24 resources**, covering the
complete operation catalog — every read and write the Spaces product itself
performs.

```typescript
import { createClient } from '@xyne/spaces-sdk';

const sdk = createClient({
  baseUrl: 'https://spaces.example.com',
  token: process.env.XYNE_SPACES_TOKEN,
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

## Install

```bash
pnpm add @xyne/spaces-sdk
```

Node 18+ or any modern browser. No runtime dependencies.

## Authentication

Pass an OAuth access token. `sdk.users.me()` reads your identity from the token's
own claims, so it costs no round trip:

```typescript
const me = await sdk.users.me();
// { id, email, name, workspaceId, memberId, clientId, scopes, expiresAt }

if (await sdk.users.isSessionExpired()) {
  sdk.setToken(await refreshSomehow());
}
```

A few operations take the acting user's id as an argument rather than reading it
server-side — `sdk.dashboards.upsert`, `sdk.tickets.upsertStageRequest`. Pass
`me.id`:

```typescript
await sdk.dashboards.upsert({ name: 'Ops', createdBy: me.id });
```

## Resources

| Resource | Methods |
|---|---|
| `sdk.activities` | 14 |
| `sdk.attachments` | 2 |
| `sdk.admin` | 31 |
| `sdk.automations` | 13 |
| `sdk.boards` | 22 |
| `sdk.calls` | 24 |
| `sdk.canvases` | 38 |
| `sdk.channels` | 41 |
| `sdk.collections` | 11 |
| `sdk.conversations` | 21 |
| `sdk.dashboards` | 8 |
| `sdk.email` | 27 |
| `sdk.forms` | 13 |
| `sdk.incidents` | 23 |
| `sdk.messages` | 33 |
| `sdk.preferences` | 18 |
| `sdk.projects` | 13 |
| `sdk.recaps` | 10 |
| `sdk.search` | 2 |
| `sdk.supportTickets` | 6 |
| `sdk.tickets` | 41 |
| `sdk.userGroups` | 18 |
| `sdk.users` | 6 |
| `sdk.workspace` | 20 |

## Things worth knowing

**Channels contain threads, threads contain messages.** `sdk.conversations.create`
starts a thread; `sdk.messages.send` replies into one. Reaching for
`messages.send` to start a conversation is the most common early mistake.

**Ids come back from creates.** For catalog mutations, the SDK generates the row
ids before sending; server-side creation workflows return their allocated ids:

```typescript
const { conversationId, messageId } = await sdk.conversations.create({ ... });
const { id } = await sdk.canvases.create({ title: 'Design notes' });
const { id: channelId } = await sdk.channels.create({ ... });
const { id: ticketId } = await sdk.tickets.create({ ... });
```

You never construct these ids yourself, and you never see the participant ids,
mapping ids, or timestamps the underlying operations also require.

**File bytes use the API transport.** Pass browser `File` objects directly, or
use `{ file: blob, filename: 'report.pdf' }` in Node. Draft uploads return ids
that catalog-backed message and ticket methods can reference:

```typescript
const uploaded = await sdk.attachments.uploadDraft({
  channelId,
  files: [reportFile],
});

await sdk.messages.send({
  conversationId,
  content: 'Report attached.',
  attachmentIds: uploaded.uploadedAttachments
    .filter((item) => item.success)
    .map((item) => item.attachmentId),
});
```

**Some updates replace rather than patch.** These take the *complete* collection
and delete anything you leave out. Read the current set first:

- `sdk.boards.update({ stages })`
- `sdk.forms.update({ fields })`
- `sdk.boards.syncTransitions()`
- `sdk.recaps.saveSubscriptions()`

**Some operations toggle rather than set.** `channels.toggleStarred`,
`conversations.togglePin`, and `canvases.toggleStarred` flip the current value.
Read the current state first if you need a specific outcome.

**Errors are typed.**

```typescript
import { AuthError, NotFoundError, RateLimitError } from '@xyne/spaces-sdk';

try {
  await sdk.tickets.get('missing');
} catch (err) {
  if (err instanceof NotFoundError) { /* ... */ }
}
```

**Support tickets are read-only here.** `sdk.supportTickets` is the desk view of
the same rows `sdk.tickets` writes to — reassigning or restaging a support ticket
goes through `sdk.tickets`.

**Collaborative canvases.** When a canvas has `isCollaborative` set, a realtime
server owns its content and writing through `canvases.update` is not a safe
read-modify-write. Save a version first.

## Coverage

The SDK's claim to completeness is checked, not asserted:

```bash
npm run coverage
```

```
catalog:  239 queries, 240 mutators (479 total)
exposed:  437
excluded: 42
accounted for: 479/479
```

Every catalog operation must be either exposed as a method or listed in
`src/exclusions.json` with a reason. A new backend operation fails the check until
someone decides which. The same check verifies that every referenced operation
actually exists and that every required argument is supplied — neither of which
TypeScript can catch, since the registries reference operations by string.

The 42 exclusions are superseded versions (`…V1` where `…V3` is exposed), plus one
the backend itself marks deprecated.

Operations absent from the catalog—creating channels and tickets and uploading
files—use the same direct API operation structure as search. See
[GAPS.md](./GAPS.md).

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

Operations route to one of three backends, chosen per operation and invisible to
callers: OAuth-protected catalog queries for reads, OAuth-protected catalog
mutators for writes, and direct API calls for anything outside the catalog.
Search established the direct API pattern; server-side channel/ticket creation
and multipart uploads now use it too. Moving an operation between transports
does not change the resource method callers use.

## Development

```bash
npm run build       # compile to dist/
npm run typecheck   # tsc --noEmit
npm run coverage    # catalog coverage gate
npm run verify      # typecheck + coverage
```
