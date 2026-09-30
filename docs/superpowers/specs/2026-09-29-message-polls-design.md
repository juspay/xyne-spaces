# XYNE-65120: Message Polls Design

## Summary

Add native, Polly-style polls to Xyne Spaces top-level channel messages. A user can create a poll with one or more multiple-choice questions, preview it, and publish it as a normal chat message. Participants can vote in real time, optionally select multiple choices, comment through the existing message thread, and add choices when the poll author permits it.

The first release supports only multiple-choice questions. Rating, ranking, free-text answers, scheduled closing, anonymous voting, and poll reopening are explicitly out of scope.

## Goals

- Create a poll from a top-level channel composer.
- Support one or more multiple-choice questions per poll.
- Require a non-empty question and between 2 and 10 non-empty, unique choices per question.
- Support `allowComments`, `allowMultipleVotes`, and `allowAudienceChoices` settings.
- Preview the complete poll before publishing.
- Publish the chat message and all poll data atomically.
- Show optimistic, real-time vote updates across connected clients.
- Let a voter change or remove their vote.
- Preserve workspace and channel access controls for poll reads and mutations.
- Render accessibly on desktop and mobile surfaces that use the dashboard chat UI.

## Non-goals

- Anonymous voting.
- Question types other than multiple choice.
- Scheduled closing, manual closing, reopening, or result hiding.
- Editing questions or choices after publication.
- Importing Polly or Slack poll history.
- Poll-specific notifications.
- Dedicated poll comments separate from message threads.
- Forwarding a poll as an interactive poll. Forwarding continues to forward the textual message representation only.

## User Experience

### Entry point

Add a `Create poll` item with the existing shared `Poll` icon to the composer attachment menu. Show it only in top-level channel composers when the user can send a normal message; do not expose it while editing or replying in a thread.

### Creation modal

The modal uses Xyne's existing dialog, form, button, checkbox, and select components. It does not copy Polly branding.

Step 1, **Compose**:

- One or more question sections.
- Each question contains question text, a fixed `Multiple choice` type indicator, and 2-10 individually editable choices.
- Settings:
  - `Allow comments`
  - `Allow multiple votes`
  - `Audience can add choices`
- `Add another question` appends a new question section.

Step 2, **Preview**:

- Shows the poll exactly as it will appear in chat, without live voting controls.
- `Back` preserves all entered values.
- `Publish` creates the poll.

Validation is inline and blocks preview/publish. Whitespace is trimmed. A question is limited to 500 characters and a choice to 200 characters. Choice uniqueness is case-insensitive within a question. The modal limits a poll to 10 questions to bound mutation size and rendering cost.

### Published poll card

The normal message header displays the author and timestamp. The poll card replaces the normal message-content renderer and contains every question. The stored message content is a generated plain-text summary of the first question (`Poll: <question>` and, when applicable, `(+N more)`), so search, notifications, older clients, and message previews remain useful without duplicating the first question in current clients.

- Single-vote polls use radio-like controls; selecting a different choice moves the user's vote atomically.
- Multiple-vote polls use checkbox-like controls; each choice can be toggled independently.
- Every option displays its count and percentage based on the question's total distinct voters.
- The current user's selected choices are visually and semantically indicated.
- If audience choices are enabled, an `Add choice` action appears per question.
- If comments are enabled, the normal reply/thread affordance remains available.
- If comments are disabled, the poll message does not expose reply-in-thread actions. Existing replies are not expected because the setting is immutable after publication.
- Deleted poll messages render the existing deleted-message state and no interactive poll.

## Data Model

Use four normalized public-schema models, all replicated through Zero.

### Poll

- `id`: primary key.
- `workspaceId`: required tenant key.
- `messageId`: unique link to the owning message.
- `createdBy`: author user ID.
- `allowComments`: boolean.
- `allowMultipleVotes`: boolean.
- `allowAudienceChoices`: boolean.
- `createdAt`: timestamp.

The owning message's `content` is the generated first-question summary used by search, notifications, older clients, and previews. Editable poll content does not have a second source of truth because questions cannot be edited after publication.

### PollQuestion

- `id`: primary key.
- `workspaceId`: required tenant key.
- `pollId`: parent poll.
- `question`: trimmed display text.
- `position`: stable zero-based order.
- `createdAt`: timestamp.

Unique `(pollId, position)` and an index on `(pollId, position)` preserve deterministic order.

### PollOption

- `id`: primary key.
- `workspaceId`: required tenant key.
- `questionId`: parent question.
- `text`: trimmed display text.
- `normalizedText`: lower-cased, collapsed-whitespace text used for uniqueness.
- `position`: stable zero-based order.
- `createdBy`: user who created the option.
- `createdAt`: timestamp.

Unique `(questionId, normalizedText)` prevents duplicate choices even when two clients add the same text concurrently. An index on `(questionId, position)` supports display order. Initial choices receive distinct positions; concurrently added audience choices may share a position and are deterministically tie-broken by `createdAt` and `id`.

Counts are derived from replicated vote rows. The maximum option/question limits keep the result bounded and avoid a second mutable aggregate source of truth.

### PollVote

- `id`: primary key.
- `workspaceId`: required tenant key.
- `pollId`: denormalized parent poll for targeted queries and ACL checks.
- `questionId`: parent question.
- `userId`: voter.
- `optionIds`: JSON array of selected option IDs.
- `createdAt`: initial response timestamp.
- `updatedAt`: last vote-change timestamp.

Unique `(questionId, userId)` stores exactly one ballot per user and question, preventing cross-device races from creating two single-choice answers. Single-vote ballots contain zero or one option ID; multiple-vote ballots may contain several unique option IDs. The backend mutator revalidates every ID against the supplied question and poll. Empty ballots are deleted.

The JSON ballot is deliberate for this first release: named per-user ballots are the source of truth and result counts are bounded client-side derivations. Anonymous voting and server-side aggregate counts are non-goals. If either enters the roadmap, the ballot and aggregation model must be redesigned and migrated rather than extending this JSON representation implicitly.

Deleting the owning message deletes the poll, questions, options, and votes in the existing message-delete mutation. Database foreign keys use cascading deletes as a final integrity backstop.

## Zero Schema and Queries

Mirror every Prisma model and relationship in `packages/shared/src/zero/schema.ts`. Add corresponding generated schema changes and keep Prisma/Zero column parity checks passing.

Poll rendering uses a targeted `pollByMessageId` query that returns:

- the poll for one visible message;
- ordered questions;
- ordered options;
- votes required to derive results and the current user's selections.

The query is enabled only when the message carries a lightweight poll discriminator in message metadata, such as `{ "messageSubtype": "poll" }`. This avoids a per-message poll subscription for ordinary messages and avoids widening the hot channel/thread message query with additional relationships.

The query must prove access through `poll → message → conversation → channel`, matching existing message/reaction visibility rules for public, private, guest-accessible, and workspace-scoped channels.

## Mutations and Data Flow

### Publishing

Extend the shared `SendPayload`, pending-message representation, replay logic, and the client/backend copies of `conversations.send` and `messages.send` with an optional validated poll draft.

Within the existing message-send transaction:

1. Validate question count, question text, choice count, choice uniqueness, and maximum lengths.
2. Generate the message summary and insert the normal message with poll metadata.
3. Insert the poll, ordered questions, and ordered options using client-generated IDs.
4. Commit all rows together or roll back all rows.

Client-generated IDs make optimistic rows identical to server-confirmed rows. Poll drafts participate in the existing pending-send/retry machinery so a top-level poll can be queued offline consistently with normal channel messages. Thread composers do not offer or accept poll drafts.

### Voting

Add a `polls.vote` mutator accepting `pollId`, `questionId`, `optionId`, desired selected state, generated ballot ID, and timestamp.

- Validate message/channel access and entity ancestry.
- For a single-vote poll, replace the ballot's option array with the selected option, or delete the ballot when deselecting it.
- For a multiple-vote poll, add or remove only the requested option in the ballot's option array.
- Removing a nonexistent vote succeeds as an idempotent no-op.
- A database uniqueness conflict caused by two devices creating the same ballot is resolved by rereading and applying the requested state to the existing ballot.

### Audience-added choices

Add a `polls.addOption` mutator accepting generated option ID, poll/question IDs, text, and timestamp.

- Reject when `allowAudienceChoices` is false.
- Validate the caller can access the owning message's channel.
- Reject blank, duplicate, over-length, or eleventh choices.
- Assign the next position inside the mutation; rendering tie-breaks concurrent additions by timestamp and ID.

The normalized-text database constraint makes duplicate additions race-safe. The maximum-count check is read-then-insert, so two distinct simultaneous additions can briefly exceed the cap; this bounded race is accepted in the first release and is documented in both mutator copies.

Poll authors use the same mutation; the setting controls post-publication additions for everyone, including the author, to keep behavior predictable.

## Authorization

Add shared query ACLs and backend mutation ACLs for all four tables and register them in both ACL factories/exports.

- Select access follows owning-message visibility and channel membership rules.
- Poll structure rows are inserted only through the send or add-option mutators.
- Votes can be inserted/deleted only for `ctx.userID`.
- Users cannot update or delete another user's vote.
- Every mutation verifies `workspaceId` through the owning channel rather than trusting client-supplied tenant fields.
- Guest behavior matches reactions: guests may vote or add a choice only when they already have mutation access to the owning channel.
- Reply creation checks the owning conversation's initial message; when it owns a poll with `allowComments = false`, the backend rejects the reply even if a stale or modified client exposes a thread composer.

## Rendering Integration

Create focused components instead of extending the already-large message/composer files with poll business logic:

- `PollComposerDialog`: owns the two-step form and validation presentation.
- `PollQuestionEditor`: edits one question and its choices.
- `PollPreview`: read-only preview shared with the dialog.
- `MessagePollCard`: subscribes to one poll and renders live questions/results.
- `PollQuestionCard`: renders options, selections, counts, and add-choice UI.

`ChatInput` coordinates opening the dialog and calls the shared send path with the resulting poll draft. `InputBox` exposes the menu action through a typed callback. `MessageBubble` conditionally replaces its normal content renderer with `MessagePollCard` for poll metadata, before attachments, nudges, and reactions.

Mobile uses the same responsive components. Interactive poll controls carry `data-prevent-thread` so tapping an option never opens the surrounding message thread.

## Error Handling

- Form validation errors remain local and preserve entered data.
- Client mutator rejection shows an actionable toast and retains the modal/pending state.
- Server application errors roll back optimistic rows through Zero and surface a toast.
- Transient Zero errors follow the existing retry semantics and do not create duplicate poll rows because IDs and unique constraints are stable.
- Vote controls disable only while their own mutation is pending; unrelated questions remain interactive.
- A query that cannot resolve the poll displays a compact unavailable state rather than falling back to unsafe metadata parsing.

## Analytics and Accessibility

Add tracked events for opening the composer, previewing, publishing, voting, removing a vote, and adding an audience choice. Do not include question or option text in analytics payloads.

The dialog has labelled fields, announced validation errors, deterministic focus on step changes, and keyboard-operable add/remove actions. Published single-choice and multi-choice questions expose appropriate radio/checkbox semantics, question grouping, selected state, counts, and percentages to assistive technology.

## Testing

### Shared/unit tests

- Poll draft validation: bounds, trimming, duplicate options, and ID stability.
- Single-vote transition removes the old choice and adds the new choice.
- Multiple-vote toggles preserve other selections.
- Idempotent add/remove behavior.
- Audience-added choice permission and duplicate/limit validation.
- Pending-message serialization and replay retain the complete poll draft.

### ACL/backend tests

- Public/private/guest/workspace read access.
- Cross-workspace IDs are rejected.
- A user cannot create or delete another user's vote.
- Poll entity ancestry is verified.
- Message deletion removes all poll rows.
- Top-level channel publishing creates the message and full poll atomically; thread poll drafts are rejected.

### Dashboard tests

- Composer validation and compose/preview navigation.
- Publishing passes the expected poll draft to the send path.
- Single- and multiple-vote controls invoke the correct mutation.
- Adding a choice respects permissions and limits.
- Disabled comments suppress thread affordances.
- Mobile controls do not open the message thread.
- Poll rendering updates when Zero query data changes.

### Verification

- Shared, dashboard, and backend typechecks.
- Focused unit/component/ACL tests.
- Prisma migration validation and Zero column parity scripts.
- Dashboard lint and build required by the repository pre-commit hook.
- Manual smoke test in public and private channels with two browser sessions, including confirmation that thread composers cannot create polls.

## Rollout and Compatibility

The feature is additive. Existing messages and queries continue to work because poll data is loaded only for messages with poll metadata. Older clients render the generated first-question summary as a normal message and ignore the structured poll rows. No backfill is required.

If rollout control is required, gate only the creation entry point; rendering must remain enabled so polls created elsewhere do not become unreadable.
