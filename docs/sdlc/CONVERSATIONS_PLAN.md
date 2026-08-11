# SDLC Human Conversations v1 — Product and Delivery Plan

Status: v1 implemented; v1.1 UX revision in progress
Owner: Xyne Spaces
Scope: desktop SDLC Hub only
Approved: 2026-08-09

## 1. Outcome

Give each SDLC pipeline or selected repository document a focused human discussion list without creating a new
chat system. Conversations remain ordinary top-level threads in the repository's hidden Channel. A generic SDLC
entity link partitions those Channel conversations by their SDLC owner.

## 2. Locked decisions

1. A pipeline is the artifact chain rooted at one PRD: `PRD → Tech Doc → Ticket → Pull Request`.
2. Every item in that chain resolves to the same conversation owner and shows the same threads.
3. A selected Wiki page or Repo Knowledge document owns an independent conversation list.
4. Only SDLC Hub surfaces participate. Normal Chat, global Wiki, global Pull Request, Ask AI, and mobile behavior
   stay unchanged.
5. Repository Channel membership controls read and write access. No per-thread membership or SDLC-specific ACL
   exists.
6. Conversation list, composer, messages, replies, mentions, reactions, attachments, notifications, unread state,
   edit/delete behavior, ordering, and pagination reuse Chat behavior.
7. Creation happens from the current owner. v1 cannot attach an existing conversation, move it, unlink it, assign
   multiple owners, or backfill historical Channel threads.
8. `Conversations` and `Assistant` are separate top-bar actions and separate right panels. Opening one closes the
   other. Existing Assistant behavior is untouched.
9. Selected conversation identity is URL-backed. Refresh, Back, and Forward preserve navigation.
10. Overview includes a view-only current-user Activity feed filtered by the hidden repository Channel.

## 3. Owner resolution

The UI asks the backend to resolve the current SDLC selection before exposing the action.

| Selected SDLC item | Conversation owner | Result |
| --- | --- | --- |
| PRD | PRD Canvas | Pipeline list |
| Tech Doc | Linked root PRD Canvas | Same pipeline list |
| Ticket | Linked root PRD Canvas | Same pipeline list |
| Pull Request | Pull Request → Ticket → root PRD Canvas | Same pipeline list |
| Wiki page | Selected Wiki Canvas | Document list |
| Repo Knowledge | Selected Baseline Canvas | Document list |
| Overview or section list | None | Hide action |
| Unlinked Ticket or Pull Request | None | Hide action |

Owner resolution uses existing, authorized repository state and `SdlcEntityLink` chain relations. Client-supplied
owner IDs are never trusted without resolution and membership checks.

## 4. Persistence

No new table or database enum is needed.

- `Channel`, `Conversation`, `Message`, and `ConversationParticipant` remain chat source of truth.
- `SdlcEntityLink` partitions conversations.
- Add `DISCUSSION` to the shared string/Zod relation union.
- Store links in one direction:
  `CANVAS:<resolved-owner-id> --DISCUSSION--> CONVERSATION:<conversation-id>`.
- The existing duplicate key prevents duplicate owner/conversation links.
- One conversation may have exactly one `DISCUSSION` owner within a repository; backend service logic enforces
  this invariant beyond the existing directional duplicate key.
- Conversation creation and link creation commit atomically. Failure leaves neither row set visible.
- Normal conversation deletion cleans up the `DISCUSSION` link in application code; Prisma relation mode means
  database cascade must not be assumed.

Pipeline, Wiki, and Repo Knowledge all use a Canvas owner ID. Canvas metadata plus authorized chain resolution
determines which owner kind applies; no new owner table is required.

## 5. Backend and sync boundary

Extend the existing `SdlcHub` boundary with narrow operations for:

- resolving a selected SDLC entity to a conversation owner;
- listing owner conversation IDs;
- creating the first normal message/conversation and its owner link atomically; and
- deleting stale discussion links when normal Chat deletes a conversation.

Reads must require repository membership, validate that every conversation belongs to the repository Channel,
and return no metadata for inaccessible or malformed links. Creation must call existing conversation/message
domain logic so Chat side effects, participants, notifications, Markdown mirrors, attachment handling, and
activity timestamps do not fork.

Mirror required Zero queries/mutators in backend and dashboard. Fetch owner links first, then subscribe to the
linked normal Conversation rows and selected thread messages. Preserve Chat ordering and pagination behavior;
do not load or expose unlinked Channel threads as a shortcut.

## 6. Desktop UX

When owner resolution succeeds, show these SDLC header actions:

- **Conversations** opens the human conversation panel.
- **Assistant** opens the existing Xyne AI panel unchanged.

Only one right panel may be open. Conversation panel uses one column:

1. list view with Chat's normal row states and **New conversation**;
2. thread view after row selection;
3. Back returns to list; and
4. closing removes the conversation query parameter.

Creation starts with Chat's normal first-message composer. Empty cancellation creates nothing. After successful
send, the URL selects the new conversation. Use existing loading, empty, offline/pending, retry, and error states.
Do not add titles, labels, manual colors, custom sorting, or SDLC-only message controls. Existing selected and
unread styling provides visual highlighting.

Suggested URL contract:

```text
/sdlc/:repoId/:section?...&conversation=:conversationId
```

Reject or clear a URL conversation that is not linked to the resolved owner or repository Channel.

## 7. Repository Activity preview

Overview reuses the current user's Activity query and presentation, filtered by `repo.channelId`.

- Include every existing matching activity type.
- Display existing read/unread state.
- Do not create new Activity rows.
- Do not mark Activity rows read from this projection.
- Do not link into the hidden Channel's normal Chat route.
- Reuse existing loading, empty, error, ordering, and pagination behavior where possible.

## 8. Failure and cleanup behavior

- Missing repository membership: deny without leaking owner or conversation metadata.
- Missing/malformed chain: hide action; direct requests return a stable not-found/conflict response.
- Conversation linked outside repository Channel: exclude and report server-side diagnostic metadata only.
- Duplicate create retry: idempotently return the created conversation or reject without duplicating link/message.
- Deleted owner: conversation remains normal Channel data; application cleanup removes stale owner links when the
  existing owner-deletion lifecycle permits it.
- Deleted conversation: remove its discussion link.
- Assistant/debugger already open: close it before opening Conversations, following existing panel ownership
  rules.

## 9. Explicit v2/deferred scope

- Ask AI awareness of these human conversation partitions.
- Common/global Ask AI chat visibility.
- Global Wiki or Pull Request entry points.
- Mobile UI.
- Attaching, moving, unlinking, merging, or multi-linking existing conversations.
- Historical backfill or an unassigned-conversation inbox.
- Conversation-specific ACLs, moderation, labels, colors, or custom notification settings.
- New SDLC Activity event types or a repository-wide shared Activity timeline.

## 10. Acceptance walkthrough

1. Open one PRD, create two conversations, reply as a second repository member, and verify both users see normal
   Chat state and notifications.
2. Open the linked Tech Doc, Ticket, and Pull Request; verify the same two conversations appear.
3. Open another pipeline; verify neither conversation appears.
4. Open one Wiki page and one Repo Knowledge document; create independent conversations and verify isolation.
5. Paste a valid conversation URL, refresh, use Back/Forward, then paste an unlinked/inaccessible ID and verify it
   is rejected without metadata leakage.
6. Switch between Conversations and Assistant; verify mutual exclusion and unchanged Assistant history/context.
7. Verify old unlinked hidden-Channel threads remain absent.
8. Delete a new conversation through normal Chat controls and verify its discussion link is removed.
9. Open Overview as two members; verify each sees only their own existing Activity feed filtered to the repository
   Channel, with no read-state mutation.
10. Verify normal Chat, global Wiki, global Pull Request, mobile, and non-SDLC repositories remain unchanged.

## 11. Implementation evidence

Implemented 2026-08-09 through shared and mirrored Zero contracts, atomic normal-conversation creation with a
`DISCUSSION` link, repository/Channel/owner validation, cleanup on Conversation and Canvas deletion, the SDLC
list/thread panel, URL selection, owner-aware top-bar actions, and the current-user repository Activity projection.

Automated checks passed:

- shared package build;
- backend typecheck;
- dashboard typecheck;
- dashboard production Vite build with an 8 GB Node heap;
- targeted dashboard ESLint with zero errors (18 pre-existing warnings); and
- `git diff --check`.

The ten-step interactive walkthrough above still requires a running authenticated stack with two repository
members. Do not treat it as completed from static/build verification alone.

## 12. v1.1 noise-reduction revision

Approved 2026-08-09:

1. Replace separate **Conversations** and **Assistant** top-bar actions with one **Chat** action.
2. The Chat side panel has **Conversations** and **AI** tabs. Switching tabs reuses the existing normal-Chat and
   Assistant domains; it does not merge their persistence.
3. The Conversations landing view is a topic index, not a normal channel timeline. Each row shows a concise
   title plus useful metadata and opens the existing full thread view.
4. Creating a conversation requires a title. No title column is added: the title is sent as the first normal
   Message, preserving the existing Conversation/Message model and all thread behavior.
5. Related Work hides Conversation entities belonging to the repository's own hidden SDLC Channel. A
   cross-Channel Conversation linked as context remains visible. `DISCUSSION` links are always same-Channel in
   v1 and therefore remain hidden there.
6. Existing AI behavior, history, context, streaming, and backend contracts remain unchanged.
