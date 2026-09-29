# Message Polls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build native, real-time, multi-question multiple-choice polls in channel and thread messages for XYNE-65120.

**Architecture:** Polls are normalized as poll, question, option, and ballot rows connected to a normal message. Existing Zero channel/thread send mutations create the message and poll graph atomically; targeted queries and dedicated mutations provide optimistic voting and audience-added choices without widening hot message queries.

**Tech Stack:** TypeScript, React 19, Prisma/PostgreSQL, Rocicorp Zero, Zod, Vitest, Jest, Tailwind/Radix UI.

**Spec:** `docs/superpowers/specs/2026-09-29-message-polls-design.md`

## Global Constraints

- Support only multiple-choice questions in this release.
- Allow 1-10 questions, 2-10 choices per question, 500 characters per question, and 200 characters per choice.
- Do not implement anonymous voting, closing/reopening, scheduled expiry, post-publication editing, or interactive forwarding.
- Poll creation must be atomic with message creation and use stable client-generated IDs.
- Every new Prisma model must have a required `workspaceId` and a matching shared Zero table.
- Reads and mutations must prove access through the owning message, conversation, channel, and workspace.
- Current Xyne styling and analytics conventions apply; do not copy Polly branding or send poll text to analytics.

---

### Task 1: Poll Draft Domain Model and Validation

**Files:**
- Create: `packages/shared/src/polls/types.ts`
- Create: `packages/shared/src/polls/validation.ts`
- Create: `packages/shared/src/polls/index.ts`
- Create: `packages/shared/test/poll-validation.test.mjs`
- Modify: `packages/shared/src/index.ts`

**Interfaces:**
- Produces: `PollDraft`, `PollQuestionDraft`, `PollOptionDraft`, `POLL_LIMITS`, `pollDraftSchema`, `normalizePollDraft(draft)`, and `buildPollMessageSummary(draft)`.
- `PollDraft` includes stable `pollId`, question IDs, option IDs, and the three boolean settings.

- [x] **Step 1: Write failing validation tests** covering trimming, bounds, case-insensitive duplicates, stable IDs, and generated one/multi-question summaries.
- [x] **Step 2: Run `pnpm --filter @xyne/shared test`** and verify the new test fails because the poll module does not exist.
- [x] **Step 3: Implement types and Zod validation** with exact limits and normalized option text:

```ts
export const POLL_LIMITS = {
  maxQuestions: 10,
  maxQuestionLength: 500,
  minOptions: 2,
  maxOptions: 10,
  maxOptionLength: 200,
} as const;

export interface PollDraft {
  pollId: string;
  allowComments: boolean;
  allowMultipleVotes: boolean;
  allowAudienceChoices: boolean;
  questions: PollQuestionDraft[];
}
```

- [x] **Step 4: Export the poll module and rerun shared tests/build** until they pass.
- [ ] **Step 5: Commit** with `feat: XYNE-65120 add poll draft validation`.

### Task 2: Persistent Poll Schema and Zero Relationships

**Files:**
- Modify: `apps/backend/prisma/schema.prisma`
- Create: `apps/backend/prisma/migrations/20260929120000_add_message_polls/migration.sql`
- Modify: `packages/shared/src/zero/schema.ts`
- Modify: `apps/backend/prisma/generated/zero/schema.ts`
- Modify: `packages/shared/src/zero/types.ts` only if a new string-backed status/type is required; avoid a PostgreSQL enum.

**Interfaces:**
- Produces Zero tables/row types `polls`, `poll_questions`, `poll_options`, and `poll_votes` plus message/poll and nested relationships.
- `poll_votes.optionIds` is JSON and unique on `(questionId, userId)`.

- [ ] **Step 1: Add a failing schema parity expectation** by adding the Prisma models first and running `bash scripts/validate-schema-migrations.sh`; expect missing Zero-model validation.
- [ ] **Step 2: Add the SQL migration** with tenant keys, foreign keys/cascades, unique constraints, and indexes from the spec.
- [ ] **Step 3: Mirror tables and relationships in shared Zero schema** and expose row types.
- [ ] **Step 4: Run Prisma generation** with `pnpm --filter xyne-spaces-backend db:generate` and retain the generated Zero schema.
- [ ] **Step 5: Run** `node scripts/validate-zero-column-parity.mjs`, shared build, and backend typecheck.
- [ ] **Step 6: Commit** with `feat: XYNE-65120 add poll persistence schema`.

### Task 3: Poll Query and Mutation ACLs

**Files:**
- Create: `packages/shared/src/zero/acl/tables/polls-acl.ts`
- Create: `packages/shared/src/zero/acl/tables/poll-questions-acl.ts`
- Create: `packages/shared/src/zero/acl/tables/poll-options-acl.ts`
- Create: `packages/shared/src/zero/acl/tables/poll-votes-acl.ts`
- Modify: `packages/shared/src/zero/acl/tables/index.ts`
- Modify: `packages/shared/src/zero/acl/index.ts`
- Modify: `packages/shared/src/zero/acl/core/query-acl-factory.ts`
- Create: `apps/backend/src/zero/acl/tables/polls-acl.ts`
- Create: `apps/backend/src/zero/acl/tables/poll-questions-acl.ts`
- Create: `apps/backend/src/zero/acl/tables/poll-options-acl.ts`
- Create: `apps/backend/src/zero/acl/tables/poll-votes-acl.ts`
- Modify: `apps/backend/src/zero/acl/tables/index.ts`
- Modify: `apps/backend/src/zero/acl/index.ts`
- Modify: `apps/backend/src/zero/acl/core/acl-factory.ts`
- Create: `apps/backend/src/zero/acl/tables/poll-votes-acl.test.ts`

**Interfaces:**
- Produces select ACLs that trace every row to an accessible owning channel.
- Produces mutation ACLs that allow structure creation only through authorized send/add-option flows and restrict ballots to `ctx.userID`.

- [ ] **Step 1: Write failing Jest ACL tests** for own vote, another user's vote, private-channel nonparticipant, guest access, and cross-workspace IDs.
- [ ] **Step 2: Run the focused Jest test** and confirm missing ACL classes fail.
- [ ] **Step 3: Implement query ACLs and register all four tables** in the shared factory.
- [ ] **Step 4: Implement backend mutation ACLs and registrations**, following reaction ACL channel-access conventions without trusting client tenant fields.
- [ ] **Step 5: Run focused ACL tests and backend typecheck** until passing.
- [ ] **Step 6: Commit** with `feat: XYNE-65120 secure poll data access`.

### Task 4: Atomic Poll Publishing and Pending Replay

**Files:**
- Modify: `packages/shared/src/messages/send.ts`
- Modify: `packages/shared/src/messages/pending.ts`
- Modify: `packages/shared/src/messages/pendingRows.ts` only if metadata is required for optimistic rows.
- Modify: `packages/shared/src/zero/mutators.ts`
- Modify: `apps/backend/src/zero/mutators.ts`
- Create: `packages/shared/test/poll-pending.test.mjs`

**Interfaces:**
- Consumes: normalized `PollDraft` and generated summary from Task 1.
- Produces: optional `poll?: PollDraft` on `SendPayload` and pending entries; both `conversations.send` and `messages.send` accept the same poll payload.

- [ ] **Step 1: Write failing pending serialization/replay tests** proving the complete poll graph survives queueing.
- [ ] **Step 2: Run the focused shared test** and verify failure.
- [ ] **Step 3: Extend send/pending types and replay** to preserve poll drafts and optimistic poll metadata.
- [ ] **Step 4: Add a shared helper inside the mutator module** that inserts poll/questions/options with `workspaceId`, normalized text, stable positions, and stable IDs.
- [ ] **Step 5: Invoke the helper after message insert in both channel and thread send mutators**, using generated message summary and `{ messageSubtype: 'poll' }` metadata.
- [ ] **Step 6: Mirror server validation and insertion in backend mutators** so optimistic and authoritative behavior match.
- [ ] **Step 7: Run shared tests/build and backend/dashboard typechecks**.
- [ ] **Step 8: Commit** with `feat: XYNE-65120 publish polls with messages`.

### Task 5: Vote, Add-Choice, Delete, and Comment Mutations

**Files:**
- Modify: `packages/shared/src/zero/mutators.ts`
- Modify: `apps/backend/src/zero/mutators.ts`
- Create: `packages/shared/src/polls/ballot.ts`
- Create: `packages/shared/test/poll-ballot.test.mjs`

**Interfaces:**
- Produces: pure `nextBallotOptionIds(current, optionId, selected, allowMultipleVotes)`.
- Produces: `mutators.polls.vote(...)` and `mutators.polls.addOption(...)`.
- Extends message reply/delete behavior for disabled comments and cascade cleanup.

- [ ] **Step 1: Write failing ballot tests** for single replacement, single deselection, multi-toggle, uniqueness, and idempotence.
- [ ] **Step 2: Run the tests and confirm failure.**
- [ ] **Step 3: Implement the pure ballot transition and export it.**
- [ ] **Step 4: Add client/server vote mutators** that validate ancestry, upsert one ballot, and resolve concurrent create conflicts by rereading.
- [ ] **Step 5: Add client/server add-option mutators** with setting, access, normalized uniqueness, limit, and deterministic order validation.
- [ ] **Step 6: Reject replies to polls with comments disabled** in both client/server message-send validation.
- [ ] **Step 7: Delete poll rows during message deletion**, relying on database cascade while keeping optimistic Zero rows consistent.
- [ ] **Step 8: Run focused tests and all three typechecks/builds.**
- [ ] **Step 9: Commit** with `feat: XYNE-65120 add poll interactions`.

### Task 6: Targeted Poll Query and Message Card

**Files:**
- Modify: `packages/shared/src/zero/queries.ts`
- Modify: `apps/backend/src/zero/queries.ts`
- Create: `apps/dashboard/src/components/Chat/Polls/MessagePollCard.tsx`
- Create: `apps/dashboard/src/components/Chat/Polls/PollQuestionCard.tsx`
- Create: `apps/dashboard/src/components/Chat/Polls/pollResults.ts`
- Create: `apps/dashboard/src/components/Chat/Polls/pollResults.test.ts`
- Modify: `apps/dashboard/src/components/ui/MessageBubble/MessageBubble.tsx`
- Modify: `apps/dashboard/src/components/Chat/ChatBubble/ChatBubble.tsx`

**Interfaces:**
- Produces: `queries.pollByMessageId({ messageId })` with ordered nested data.
- Produces: `calculatePollResults(options, ballots)` returning per-option counts, percentages, distinct voter count, and current selections.

- [ ] **Step 1: Write failing result-calculation tests** for no votes, single/multiple ballots, percentages, and distinct voters.
- [ ] **Step 2: Run Vitest and verify failure.**
- [ ] **Step 3: Add matching shared/backend targeted queries** gated by owning-message access.
- [ ] **Step 4: Implement pure result calculation** and make tests pass.
- [ ] **Step 5: Implement accessible option controls and audience add-choice UI** wired to Zero mutations with per-question pending state and toasts.
- [ ] **Step 6: Mount the card for `messageSubtype === 'poll'`**, replace normal content, suppress thread actions when comments are disabled, and add `data-prevent-thread` to controls.
- [ ] **Step 7: Run dashboard tests, lint, and typecheck.**
- [ ] **Step 8: Commit** with `feat: XYNE-65120 render and vote on message polls`.

### Task 7: Poll Composer and Preview

**Files:**
- Create: `apps/dashboard/src/components/Chat/Polls/PollComposerDialog.tsx`
- Create: `apps/dashboard/src/components/Chat/Polls/PollQuestionEditor.tsx`
- Create: `apps/dashboard/src/components/Chat/Polls/PollPreview.tsx`
- Create: `apps/dashboard/src/components/Chat/Polls/pollComposerState.ts`
- Create: `apps/dashboard/src/components/Chat/Polls/pollComposerState.test.ts`
- Modify: `apps/dashboard/src/components/ui/InputBox/InputBox.types.ts`
- Modify: `apps/dashboard/src/components/ui/InputBox/InputBox.tsx`
- Modify: `apps/dashboard/src/components/Chat/ChatInput/ChatInput.tsx`
- Modify: `packages/shared/src/logger/events.ts`

**Interfaces:**
- Produces: `onCreatePoll?: () => void` on `InputBoxProps`.
- Produces: `PollComposerDialog` callback `onPublish(draft: PollDraft): void`.
- Consumes: `sendMessage(..., { poll })` from Task 4.

- [ ] **Step 1: Write failing state tests** for initial two choices, add/remove question/choice, normalization, and preview eligibility.
- [ ] **Step 2: Run Vitest and verify failure.**
- [ ] **Step 3: Implement pure composer state helpers** and make tests pass.
- [ ] **Step 4: Implement the responsive two-step dialog** using existing Xyne controls, inline errors, focus management, and preview preservation.
- [ ] **Step 5: Add `Create poll` with the shared Poll icon to the attachment menu**, hidden during editing.
- [ ] **Step 6: Wire ChatInput publication** for channel/thread contexts through the shared send path, including analytics without user-entered text.
- [ ] **Step 7: Run dashboard tests, lint, typecheck, and build.**
- [ ] **Step 8: Commit** with `feat: XYNE-65120 add poll composer`.

### Task 8: End-to-End Verification and PR Readiness

**Files:**
- Modify only files needed to fix verification failures.

**Interfaces:**
- Produces a clean branch ready for review, with no generated or formatting drift.

- [ ] **Step 1: Run shared tests/build:** `pnpm --filter @xyne/shared test`.
- [ ] **Step 2: Run focused backend ACL tests and backend typecheck.**
- [ ] **Step 3: Run dashboard Vitest, lint, typecheck, and build.**
- [ ] **Step 4: Run migration/tenant/enum/raw-SQL/Zero parity checks used by pre-commit.**
- [ ] **Step 5: Inspect `git diff --check`, generated-schema changes, migration SQL, ACL registration, and working-tree status.**
- [ ] **Step 6: Perform manual two-session smoke testing when local services are available; otherwise document that limitation in the handoff.**
- [ ] **Step 7: Commit verification fixes** with `fix: XYNE-65120 resolve poll verification issues` only if files changed.
