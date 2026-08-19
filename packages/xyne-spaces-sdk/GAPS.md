# Catalog gaps

The Zero catalog contains 254 queries and 244 mutators. It still deliberately
does not contain operations that require multipart transfer, external side
effects, or server-owned sequence allocation. Those are transport gaps, not SDK
gaps: the SDK exposes them as direct `api` registry operations, following the
structure originally used only by `sdk.search`.

## Covered outside the catalog

| Operation | SDK method | Public SDK route | Existing product workflow |
|---|---|---|---|
| Create a channel | `sdk.channels.create` | `POST /api/sdk/channels` | `POST /api/channels` |
| Check channel-name uniqueness | `sdk.channels.checkDuplicate` | `POST /api/sdk/channels/check-duplicate` | `POST /api/channels/check-duplicate` |
| Create a ticket | `sdk.tickets.create` | `POST /api/sdk/tickets` | `POST /api/tickets` |
| Create a conversation with file bytes | `sdk.conversations.createWithAttachments` | `POST /api/sdk/channels/:channelId/conversations` | `POST /api/channels/:channelId/conversations` |
| Upload entity attachments | `sdk.attachments.upload` | `POST /api/sdk/attachments` | `POST /api/attachments/upload` |
| Upload draft attachments | `sdk.attachments.uploadDraft` | `POST /api/sdk/draft-attachments` | `POST /api/drafts/attachments/upload` |
| Search Vespa | `sdk.search.query` | `GET /api/sdk/search` | `GET /api/vespaSearch` |

The `/api/sdk` routes authenticate SDK OAuth access tokens, apply SDK scopes and
rate limits, and then delegate to the established product controllers. This
keeps sequence allocation, workspace checks, file storage, assignment, search
indexing, and side effects in one implementation.

Each of these routes declares a `request.body` schema in
`api/sdk/domains/catalog-gaps.ts`. Those schemas are declaration-only — every
field is optional and every object is `.passthrough()`, so runtime behaviour is
unchanged and requiredness stays in the controllers. What they buy is
`npm run contract-check`, which compares each operation's input type against the
field set its route declares. Without them these operations had nothing to check
against, which is how three non-existent search parameters shipped.

## A different kind of gap: Claw

`sdk.claw` is not a catalog gap or a transport gap. It is a **different service**.

| Operation | SDK method | Route |
|---|---|---|
| Device-flow login | `sdk.claw.login` | `POST /claw/api/v1/cli/auth/{start,token}` |
| List agents | `sdk.claw.listAgents` | `GET /claw/api/v1/agents` |
| List runs | `sdk.claw.listSessions` | `GET /claw/api/v1/runs/light` |
| Dispatch a run | `sdk.claw.runAgent` | `POST /claw/api/v1/run` |
| Read a run | `sdk.claw.getRun` | `GET /claw/api/v1/runs/:sessionId` |

`/claw/api/v1` is served by `apps/xyne-claw-auth`, which has its own database and
accepts only its own `xyne_cli_` / `xyne_svc_` tokens. A Spaces OAuth token is a
stateless RS256 JWT and fails its verifier outright, so Claw carries a **separate
credential** and its own `HttpClient`. `setToken()` and `setClawToken()` never
affect each other. This is the one place the SDK's transport choice is visible to
callers, and the reason is documented in `core/claw-auth.ts`.

## The selected approach

This is approach 1 from the original gap analysis: add direct API operations to
the registry. Each public resource method remains a thin wrapper around one
typed registry entry, just like search:

```typescript
create: api<CreateChannelInput, { id: string }>(
  'POST',
  '/api/sdk/channels',
)
```

For multipart operations, `mapArgs` builds `FormData`; the shared transport
recognizes it and lets `fetch` supply the boundary. JSON operations continue to
use the same transport unchanged.

## Attachment flow

Files can be sent inline with `tickets.create` and
`conversations.createWithAttachments`, or uploaded to a draft first. Draft
uploads return attachment ids, which can be passed to `messages.send`,
`conversations.create`, or `tickets.create`. Callers do not allocate draft,
attachment, channel, ticket, conversation, or message ids themselves.

## Exclusions

The 47 entries in `src/exclusions.json` are a separate catalog concern:

| Reason | Count | What it means |
|---|---|---|
| `superseded-by:<name>` | 45 | An older version where a newer one is exposed |
| `legacy-unused` | 1 | `myChannelParticipations` — backend-marked deprecated |
| `deferred:<why>` | 1 | `activeSlashCommandArtifacts` — takes no arguments and is scoped entirely to the caller's own id; it drives an in-product banner and has no standalone value for an API client |

Direct API operations and `sdk.claw` are outside the catalog coverage
denominator, so `npm run coverage` accounts for all 498 catalog operations:

```
catalog:  254 queries, 244 mutators (498 total)
exposed:  451
excluded: 47
accounted for: 498/498
```
