# Message Polls Review Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the correctness and usability findings from the Xyne AI review of PR #2487 without expanding the approved poll feature scope.

**Architecture:** Keep polls as top-level channel messages, enforce disabled comments in both the normal Zero path and PostgreSQL, remove poll data when its message is deleted, and centralize poll normalization/policy rules in `@xyne/shared`. Surface authoritative mutation failures in the existing dashboard toast system and retain the current JSON ballot representation because anonymous polls and server-side result aggregation remain out of scope.

**Tech Stack:** TypeScript, React, Zod, Rocicorp Zero, Prisma/PostgreSQL, Node test runner, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-29-message-polls-design.md`

## Global Constraints

- Polls may be created only as top-level channel messages.
- Disabled comments must be enforced for Zero, bot, API, and direct Prisma message inserts.
- Deleted poll messages must stop exposing poll data and accepting mutations.
- Normalized choice text must be deterministic across browser/server locales.
- Preserve the existing JSON ballot schema and document the deliberate non-goal decision.
- Every behavior change follows a red-green test cycle before implementation.

---

### Task 1: Shared poll policies and normalization

**Files:**

- Create: `packages/shared/src/polls/policy.ts`
- Create: `packages/shared/test/poll-policy.test.mjs`
- Modify: `packages/shared/src/polls/validation.ts`
- Modify: `packages/shared/src/polls/index.ts`
- Modify: `packages/shared/src/zero/mutators.ts`
- Modify: `apps/backend/src/zero/mutators.ts`

**Interfaces:**

- Produces `normalizePollChoice(text)`, `assertPollPlacement(poll, placement)`, `assertPollMessageActive(message)`, and `isPollMessageMetadata(metadata)`.
- Poll draft validation and option persistence consume the same normalization helper.

- [x] **Step 1: Write failing shared tests** for Unicode/case/whitespace normalization, thread placement rejection, deleted-message rejection, and poll metadata detection.
- [x] **Step 2: Run the focused shared test and verify it fails because the policy module is missing.**
- [x] **Step 3: Implement the policy helpers and replace every locale-dependent option normalization call.**
- [x] **Step 4: Apply placement and active-message checks to shared/backend poll mutators.**
- [x] **Step 5: Run the shared test suite and both backend/shared typechecks.**

### Task 2: Deleted polls and disabled comments

**Files:**

- Modify: `apps/backend/src/zero/acl/tables/poll-acl-utils.ts`
- Modify: `apps/backend/src/zero/acl/tables/poll-votes-acl.test.ts`
- Modify: `packages/shared/src/zero/mutators.ts`
- Modify: `apps/backend/src/zero/mutators.ts`
- Modify: `apps/backend/prisma/migrations/20260929120000_add_message_polls/migration.sql`

**Interfaces:**

- `requireAccessiblePoll` rejects a deleted owning message.
- Message deletion removes the owning poll row; database cascades remove questions, choices, and ballots.
- A PostgreSQL trigger rejects any reply insert when the root poll has comments disabled.

- [x] **Step 1: Add a failing ACL test proving a deleted poll cannot accept a ballot.**
- [x] **Step 2: Run the focused ACL test and verify the deleted case currently succeeds.**
- [x] **Step 3: Reject deleted owning messages in the poll ACL and poll mutations.**
- [x] **Step 4: Delete the poll before soft- or hard-deleting its message in both mutator copies.**
- [x] **Step 5: Add the migration trigger and validate the migration/Zero schema guards.**
- [x] **Step 6: Run focused ACL tests and backend typecheck.**

### Task 3: Dashboard behavior and mutation errors

**Files:**

- Modify: `apps/dashboard/src/components/Chat/ChatInput/ChatInput.tsx`
- Modify: `apps/dashboard/src/components/Chat/ChatBubble/ChatBubble.tsx`
- Modify: `apps/dashboard/src/components/Chat/Polls/MessagePollCard.tsx`
- Modify: `apps/dashboard/src/components/ui/MessageBubble/MessageBubble.tsx`
- Modify: `packages/shared/src/zero/queries.ts`
- Modify: `apps/backend/src/zero/queries.ts`

**Interfaces:**

- Thread composers do not expose poll creation.
- Poll messages cannot enter the generic message editor.
- Vote/add-choice mutations use `surfaceMutationError` and retain input after failure.
- `pollByMessageId` receives `channelId` so ACLs use the channel-scoped path.

- [x] **Step 1: Add pure/component regression coverage where existing harnesses support it.**
- [x] **Step 2: Hide thread creation/edit affordances and add server-side edit rejection.**
- [x] **Step 3: Surface authoritative mutation failures and use shared poll limits/copy.**
- [x] **Step 4: Add channel scoping to the poll query without trusting a guessed membership flag.**
- [ ] **Step 5: Run dashboard tests, lint, typecheck, and production build.**

### Task 4: Verification and PR update

**Files:**

- Modify only files required by verification failures.

**Interfaces:**

- Produces a clean pushed PR head and a review response mapping every finding to a fix or explicit decision.

- [ ] **Step 1: Run shared tests, focused ACL tests, backend typecheck/build, dashboard tests/build, migration validation, and Zero parity.**
- [ ] **Step 2: Inspect the final diff, generated files, and worktree status.**
- [ ] **Step 3: Commit through repository hooks and push the PR branch.**
- [ ] **Step 4: Post a concise PR comment covering items 1–8 and remaining manual smoke-test limits.**
