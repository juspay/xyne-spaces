# Chat projects API

Route contract for **XYNE-66808**, written for **XYNE-66812** (the Spaces-side
proxy in `apps/backend/src/routes/xyneAI.ts`) and **XYNE-66813** (the sidebar).

Implementation: `apps/xyne-claw-auth/backend/src/routes/chat-projects.ts`,
mounted into `agentChatRouter`, so every path below is served under the
agent-chat base.

**Base path:** `/claw/api/v1/agent-chat`

## Identity and scope

Every route resolves the caller from two headers:

| Header | Meaning |
| --- | --- |
| `x-user-id` | canonical Claw id — **new rows are written under this one** |
| `x-spaces-user-id` | the workspace-scoped Spaces id, when present |

Both are treated as the same person. Reads match **either**; writes persist
under the canonical id. A proxy that forwards only one of them will not see
projects created under the other, so **forward both**.

`x-org-id` scopes every query. When absent the service falls back to the org on
the caller's own user record; if that also fails the request is `400`.

Access is **owner-only**. A project belonging to another user — or to another
org — is reported as `404`, never `403`, so an id cannot be probed for
existence. Treat `404` as "no such project for you" rather than "deleted".

## Project object

```jsonc
{
  "id": "clx…",
  "ownerUserId": "user_…",
  "orgId": "org_…",
  "name": "Research",
  "icon": "flask",                 // or null
  "instructions": "Cite sources.", // "" when unset
  "instructionsEnabled": true,     // soft toggle; text is retained when false
  "spacesProjectId": "proj_…",     // or null — Spaces Project, not FK-enforced
  "defaultAgentSlug": "assistant", // or null
  "sortOrder": 0,
  "createdAt": "2026-10-19T…Z",
  "updatedAt": "2026-10-19T…Z",
  "chatCount": 2                   // list + create + get only
}
```

`instructionsEnabled: false` keeps the text on the row but stops it being
injected into runs (XYNE-66810). It is not a delete.

## Endpoints

All responses are `{ "success": true, "data": … }` or
`{ "success": false, "error": "…" }`.

### `GET /chat/projects`

The caller's projects, ordered by `sortOrder` then `createdAt`. Each carries
`chatCount`.

`200` → `data: Project[]` · `401` no verified id · `400` no org context

### `POST /chat/projects`

```jsonc
{
  "name": "Research",            // required, 1–120 chars, trimmed
  "icon": "flask",               // optional, ≤64 chars, "" or null clears
  "instructions": "Cite sources.", // optional, ≤10000 chars
  "instructionsEnabled": true,   // optional, defaults true
  "spacesProjectId": "proj_…",   // optional, ≤128 chars
  "defaultAgentSlug": "assistant" // optional, ≤128 chars
}
```

New projects are appended to the end of the owner's order.

`201` → `data: Project` (`chatCount: 0`) · `400` validation · `401` · `400` no org

### `GET /chat/projects/:projectId`

`200` → `data: Project & { conversationIds: string[] }`, newest membership
first · `404` not found **or not yours**

### `PATCH /chat/projects/:projectId`

Any subset of the create fields except that `name`, when present, must still be
non-empty. **Only the fields sent are written** — omitting `instructions`
leaves it untouched. An empty string on `icon`, `spacesProjectId` or
`defaultAgentSlug` clears it to `null`.

`200` → `data: Project` · `400` validation or empty body · `404` not found/not yours

### `DELETE /chat/projects/:projectId`

Deletes the project and cascades its membership rows. **Chats are never
deleted** — every conversation it held returns to the main list.

`200` → `data: { id, deleted: true }` · `404` not found/not yours

### `PUT /chat/projects/reorder`

```jsonc
{ "projectIds": ["clx2", "clx1"] }   // ≤500 ids
```

Assigns `sortOrder` by array index. Ids the caller does not own match nothing
and are skipped rather than erroring, so a stale client list still renumbers
what it legitimately can — compare `reordered` against `projectIds.length` to
detect that.

`200` → `data: { reordered: number }` · `400` not an array of non-empty strings, or over 500

## Status codes

| Code | When |
| --- | --- |
| `200` | success |
| `201` | project created |
| `400` | validation failure, empty PATCH, or no resolvable org |
| `401` | neither `x-user-id` nor `x-spaces-user-id` present |
| `404` | project absent, owned by someone else, or in another org |
| `500` | unexpected — logged under `chat-projects` |

## Notes for the proxy (XYNE-66812)

1. **Forward both id headers.** Dropping `x-spaces-user-id` hides projects
   whose rows are keyed under it.
2. **Do not translate 404 to 403.** The indistinguishability is deliberate.
3. **`chatCount` is per caller**, derived from membership rows matching their
   ids — not a global count of chats in the project.
4. **Membership is keyed `[conversationId, userId]`, with no agent.** A chat
   answered by several agents sits in exactly one project. Do not add
   `agentSlug` to any project call.
5. **`spacesProjectId` has no foreign key and is not access-checked on write.**
   It points into the Spaces database, which claw-auth reads through a
   read-only grant, so it can dangle if the Spaces project is deleted — render
   defensively. A user can also link a project they cannot see: whatever pulls
   that project's tickets or channels into a run must re-check the caller's
   access **every time** (XYNE-66811). Do not treat a stored id as proof of
   access.

## Filing chats (XYNE-66809)

These live on the conversation routes, not under `/chat/projects`.

### `PATCH /:slug/chat/:convId`

Already takes `title` and `pinned`; now also `projectId`.

```jsonc
{ "projectId": "clx…" }   // file into a project
{ "projectId": null }      // unfile — back to the main list
```

Omitting the key leaves membership untouched. At least one of `title`,
`pinned`, `projectId` is required.

The response now carries the resulting membership:

```jsonc
{ "title": "…", "pinned": false, "projectId": "clx…" }
```

`404` when the chat is not the caller's **or** the target project is not theirs
— the two are not distinguished. Only the chat's owner can move it, and only
into a project they own in the same org.

### `GET /conversations` — `?projectId=`

- `?projectId=<id>` — only that project's chats. `404` if it is not the
  caller's.
- `?projectId=none` — only unfiled chats.
- omitted — everything.

Filtering happens **inside** the list aggregate, so cursor pagination walks a
complete, correctly ordered set. (Contrast `q`, which is matched in memory and
therefore cannot page past the first screenful.) A project with no chats
returns an empty page, never the full history.

Every row now carries `projectId: string | null`, and the paged response adds:

```jsonc
{ "data": [...], "nextCursor": "…", "agents": [...], "projectCounts": { "clx…": 12 } }
```

`projectCounts` is **not** narrowed by `?projectId=` — the sidebar shows every
project's total while one of them is open. It comes from the same source as
`chatCount` on `GET /chat/projects`, so the two cannot disagree.

### Deleting a chat

`DELETE /:slug/chat/:convId` now also reclaims the chat's `ChatProjectItem`,
but only once the caller has no messages left in that conversation — a chat
answered by several agents survives a per-agent delete and keeps its project.
There is no foreign key between membership and messages (a conversation is
only an id shared by message rows), so nothing else would clean it up.

## Not yet exposed

Injecting a project's instructions into runs is **XYNE-66810**;
`enabledInstructionsForConversation` is ready for it. Project knowledge is
**XYNE-66811**.
