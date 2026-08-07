# Coverage gaps

The SDK exposes the Zero operation catalog — 239 queries and 240 mutators, all of
which are either surfaced as a method or listed in `src/exclusions.json` with a
reason. `npm run coverage` enforces that.

What the catalog does *not* contain is a handful of operations the Spaces
frontend performs through plain Express routes. They are absent from the SDK for
the same reason they are absent from the catalog: they need multipart uploads,
external side effects, or sequence allocation that the Zero mutator model does
not express.

This file inventories them so the omission is a known quantity rather than a
surprise.

## Not available through the SDK

| Operation | Where it lives | Why it is not a mutator |
|---|---|---|
| **Create a channel** | `POST /api/channels` | Allocates a channel plus its stats, participants, and default section in one server-side transaction, and checks title uniqueness first (`POST /api/channels/check-duplicate`). |
| **Create a ticket** | `POST /api/tickets` | Allocates the next `xyneId` from a per-project sequence, accepts file attachments in the same multipart request, and runs board/assignee suggestion. |
| **Create a conversation with attachments** | `POST /api/channels/:channelId/conversations` | The catalog's `conversations.send` covers the text-only case; this route additionally accepts uploads. |
| **Upload an attachment** | `POST /api/attachments`, `POST /api/draft-attachments` | Multipart file transfer to object storage. The catalog's `draft.createAttachments` records metadata for files that have *already* been uploaded. |
| **Search** | `GET /api/vespaSearch` | Vespa, not Postgres. Exposed as `sdk.search` through the API transport rather than a Zero query. |

Note the pattern for attachments: **upload first, then reference**. Once a file
exists, `messages.addDraftAttachments`, `messages.deleteAttachment`, and the
`attachmentIds` argument on `messages.send` / `conversations.create` all work
normally through the SDK.

## What this means in practice

Creating a channel or ticket from an SDK client currently requires calling those
Express routes directly with the same access token. Everything that happens to a
channel or ticket *after* creation — updating, assigning, staging, commenting,
archiving — is fully covered.

## If these should be covered

Two options, in increasing order of effort:

1. **Add API operations to the registry.** The registry already supports an
   `api` operation type (that is how `sdk.search` works). Wrapping the create and
   upload routes is mechanical, and the resource methods would be
   indistinguishable from the rest of the SDK. The routes would need to accept
   SDK access tokens, which today they do not.
2. **Add mutators to the catalog.** Better long-term, since it would give the
   frontend and the SDK one path, but sequence allocation and file transfer both
   need designing into the mutator model first.

## Deliberate exclusions

Separately from the above, 42 catalog operations are excluded in
`src/exclusions.json`. All but one are superseded versions — where `…V3` exists
and is exposed, `…V1` and `…V2` are not. The exception is
`myChannelParticipations`, which the backend itself marks
`@deprecated Unused by frontend`.

No exclusion is there to make a number look better: excluding an operation
someone needs would show up as a missing method, not as a passing check.
