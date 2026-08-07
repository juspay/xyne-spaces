# Catalog gaps

The Zero catalog contains 239 queries and 240 mutators. It still deliberately
does not contain operations that require multipart transfer, external side
effects, or server-owned sequence allocation. Those are transport gaps, not SDK
gaps: the SDK now exposes them as direct `api` registry operations, following
the structure originally used only by `sdk.search`.

## Covered outside the catalog

| Operation | SDK method | Public SDK route | Existing product workflow |
|---|---|---|---|
| Create a channel | `sdk.channels.create` | `POST /api/v1/channels` | `POST /api/channels` |
| Check channel-name uniqueness | `sdk.channels.checkDuplicate` | `POST /api/v1/channels/check-duplicate` | `POST /api/channels/check-duplicate` |
| Create a ticket | `sdk.tickets.create` | `POST /api/v1/tickets` | `POST /api/tickets` |
| Create a conversation with file bytes | `sdk.conversations.createWithAttachments` | `POST /api/v1/channels/:channelId/conversations` | `POST /api/channels/:channelId/conversations` |
| Upload entity attachments | `sdk.attachments.upload` | `POST /api/v1/attachments` | `POST /api/attachments/upload` |
| Upload draft attachments | `sdk.attachments.uploadDraft` | `POST /api/v1/draft-attachments` | `POST /api/drafts/attachments/upload` |
| Search Vespa | `sdk.search.query` | `GET /api/v1/search` | `GET /api/vespaSearch` |

The `/api/v1` routes authenticate SDK OAuth access tokens, apply SDK scopes and
rate limits, and then delegate to the established product controllers. This
keeps sequence allocation, workspace checks, file storage, assignment, search
indexing, and side effects in one implementation.

## The selected approach

This is approach 1 from the original gap analysis: add direct API operations to
the registry. Each public resource method remains a thin wrapper around one
typed registry entry, just like search:

```typescript
create: api<CreateChannelInput, { id: string }>(
  'POST',
  '/api/v1/channels',
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

The 42 entries in `src/exclusions.json` remain a separate catalog concern: all
but one are superseded versions, and the remaining operation is backend-marked
deprecated. Direct API operations are outside the catalog coverage denominator,
so `npm run coverage` continues to account for all 479 catalog operations.
