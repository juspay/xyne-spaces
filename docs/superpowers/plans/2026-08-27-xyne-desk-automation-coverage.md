# Xyne Desk Automation Coverage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the Xyne Desk automation callable, genuinely UI-driven for user workflows, and complete for routing and bulk Pub/Sub behavior.

**Architecture:** Mount the test-only Desk fixture router alongside test auth routes. Extend Gauge steps to drive the existing Desk UI for reply, compose, ticket updates, merge, and unmerge, while using fixture APIs only to inject data and verify provider outcomes. Add independent negative routing and bulk-delivery assertions.

**Tech Stack:** Express/TypeScript backend, Gauge TS, Playwright, Prisma, existing Desk integration APIs.

**Spec:** User-provided Xyne Desk happy-flow checklist in conversation.

## Global Constraints

- Test routes remain available only in test/dev-auth environments and with `DESK_MOCK_ENABLED=true`.
- Do not alter unrelated working-tree files.
- UI steps must assert visible state, not only API response IDs.

### Task 1: Mount Desk test routes

**Files:** Modify `apps/backend/src/app.ts`.

- [ ] Import `testDeskRoutes` and mount it at `/api/test` inside the existing test/dev-auth guard.
- [ ] Run the backend typecheck or route compilation check available in the repository.

### Task 2: Strengthen existing Desk assertions

**Files:** Modify `tools/xyne-automation/tests/03_e2e/11_xyne-desk/xyne-desk.steps.ts`, specs 02/03/06.

- [ ] Make ingestion verification fetch ticket/email details and assert persisted subject, body, sender, and channel.
- [ ] Add admin-positive mailbox configuration.
- [ ] Add explicit “email absent from channel” routing assertions.
- [ ] Send Slack fixtures through a Slack-specific mock endpoint and verify the resulting ticket.

### Task 3: Convert user workflows to browser interactions

**Files:** Modify Desk step definitions and specs 01/05/07/09.

- [ ] Use existing Desk selectors/UI controls to reply and reply-all.
- [ ] Compose through the Desk composer UI and verify the provider capture afterward.
- [ ] Update priority/status through ticket controls and verify visible persisted state.
- [ ] Merge and unmerge through ticket UI actions and verify visible state plus API outcome.

### Task 4: Add Pub/Sub bulk flow

**Files:** Modify mock Desk route/service and add `11_pubsub-bulk-mail-flow.spec` plus steps.

- [ ] Add a deterministic bulk publish/consume fixture endpoint using the existing process-local mock service.
- [ ] Assert all messages are delivered once, routed to the expected channels, and remain absent from unrelated channels.
- [ ] Exercise one retryable failure and assert eventual delivery without duplication.

### Task 5: Verify and commit

- [ ] Run automation integrity/type checks available in the environment.
- [ ] Review the final diff and commit only Desk automation changes.
