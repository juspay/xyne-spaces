# Catalog gaps

The Zero catalog contains 508 operations — 263 queries and 245 mutators — and the
SDK reaches almost all of them through one pair of endpoints. It deliberately does
not contain operations that need multipart transfer, external side effects, or
server-owned sequence allocation.

Those are **transport** gaps, not capability gaps. The SDK exposes them as direct
`api` registry entries, following the structure originally used only by
`sdk.search`. Callers cannot tell the difference: `sdk.channels.create` and
`sdk.channels.list` look identical at the call site.

## Covered outside the catalog

| Operation | SDK method | Route | Why it is not a catalog operation |
|---|---|---|---|
| Identify the caller | `sdk.users.me` | `GET /api/sdk/me` | An API key is opaque; there are no claims to read locally |
| Create a channel | `sdk.channels.create` | `POST /api/sdk/channels` | Allocates server-owned associated rows |
| Check channel-name uniqueness | `sdk.channels.checkDuplicate` | `POST /api/sdk/channels/check-duplicate` | Paired with the above |
| Create a ticket | `sdk.tickets.create` | `POST /api/sdk/tickets` | Project sequence allocator |
| Create a thread with files | `sdk.conversations.createWithAttachments` | `POST /api/sdk/channels/:channelId/conversations` | Multipart |
| Upload entity attachments | `sdk.attachments.upload` | `POST /api/sdk/attachments` | Multipart + file storage |
| Upload draft attachments | `sdk.attachments.uploadDraft` | `POST /api/sdk/draft-attachments` | Multipart + file storage |
| Search | `sdk.search.query` | `GET /api/sdk/search` | Vespa, not Postgres |
| Search field definitions | `sdk.search.getSchema` | `GET /api/sdk/search/schema` | Index introspection |

Each of these delegates to the **same product controller the application calls**.
Sequence allocation, workspace checks, file storage, assignment, search indexing,
and side effects stay in one implementation — forking any of them for the SDK
would be the fastest way to make SDK behaviour quietly disagree with product
behaviour.

## Claw: a different service, not a gap

`sdk.claw` is neither a catalog gap nor a transport gap. Xyne Claw is a **separate
service** (`apps/xyne-claw-auth`) with its own database, and its verifier accepts
only its own credentials — a Spaces key is not valid there.

Rather than making callers hold two credentials, Spaces relays:

| Operation | SDK method | Route |
|---|---|---|
| List agents | `sdk.claw.listAgents` | `GET /api/sdk/claw/agents` |
| Dispatch a run | `sdk.claw.run` | `POST /api/sdk/claw/runs` |
| Read a run | `sdk.claw.getRun` | `GET /api/sdk/claw/runs/:sessionId` |

The backend calls Claw with the deployment's own service credential and passes the
caller's identity through explicitly. `sdk.claw.runAndWait` is a client-side
convenience over `run` + `getRun`; it adds no endpoint.

## Exclusions

The 57 entries in `src/exclusions.json` are a separate concern — operations that
exist in the catalog but are deliberately not surfaced:

| Reason | Count | Meaning |
|---|---|---|
| `superseded-by:<name>` | 45 | An older version where a newer one is exposed |
| `deferred:sdlc` | 10 | The software-development-lifecycle subsystem: repos, links, baselines, discussions. Internal, driven by its own services and Claw execution profiles. Exposing it is a product decision |
| `legacy-unused` | 1 | `myChannelParticipations` — backend-marked deprecated |
| `deferred:<why>` | 1 | `activeSlashCommandArtifacts` — takes no arguments, scoped entirely to the caller's own id, and drives an in-product banner |

Direct API operations and `sdk.claw` sit outside the catalog denominator, so
`npm run coverage` accounts for all 508 catalog operations exactly:

```
catalog:  263 queries, 245 mutators (508 total)
exposed:  451
excluded: 57
accounted for: 508/508
```

## Attachment flow

Files can be sent inline with `tickets.create` and
`conversations.createWithAttachments`, or uploaded to a draft first. Draft uploads
return attachment ids that can then be passed to `messages.send`,
`conversations.create`, or `tickets.create`. Callers never allocate draft,
attachment, channel, ticket, conversation, or message ids themselves.
