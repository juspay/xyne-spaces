-- Opt-in per channel. When true, ticket creation in this channel requires an ETA, and
-- HIGH/CRITICAL tickets may name an existing task they should go ahead of, staying blocked until
-- that task's owner accepts. Defaults false so every channel that has not opted in keeps its
-- current create flow untouched.
ALTER TABLE "public"."channels" ADD COLUMN "priorityConflictEnabled" BOOLEAN NOT NULL DEFAULT false;

-- One attempt by "ticketId" to be taken up ahead of "supersededTicketId". Append-only history:
-- re-picking withdraws the current PENDING row and inserts a new one, preserving the trail.
--
-- "state" is one of PENDING | ACCEPTED | WITHDRAWN, stored as TEXT to match this schema's
-- convention of plain text over Postgres enums. There is deliberately no REJECTED state: the
-- superseded owner is never asked to reject, so silence is what keeps a ticket blocked.
CREATE TABLE "public"."priority_conflict_claims" (
    "workspaceId" TEXT,
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "supersededTicketId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'PENDING',
    "justification" TEXT NOT NULL,
    "raisedBy" TEXT NOT NULL,
    "respondentId" TEXT NOT NULL,
    "respondedBy" TEXT,
    "respondedAt" TIMESTAMP(3),
    "responseNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "priority_conflict_claims_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "priority_conflict_claims_ticketId_idx" ON "public"."priority_conflict_claims"("ticketId");
CREATE INDEX "priority_conflict_claims_ticketId_state_idx" ON "public"."priority_conflict_claims"("ticketId", "state");
CREATE INDEX "priority_conflict_claims_supersededTicketId_idx" ON "public"."priority_conflict_claims"("supersededTicketId");
-- Powers the "what am I being asked to accept" inbox for a respondent.
CREATE INDEX "priority_conflict_claims_respondentId_state_idx" ON "public"."priority_conflict_claims"("respondentId", "state");
CREATE INDEX "priority_conflict_claims_channelId_idx" ON "public"."priority_conflict_claims"("channelId");

-- No FOREIGN KEY constraints: this datasource runs relationMode = "prisma", so relations are
-- enforced in the client layer and the indexes above stand in for the FK-backed ones. The user
-- columns ("raisedBy", "respondentId", "respondedBy") are bare TEXT for the same reason and to
-- match the convention used by ticket_stage_requests — user rows are never hard-deleted, so a
-- claim's audit trail stays readable even after someone leaves.
--
-- No NotificationType enum migration is needed on this base: notifications.type is TEXT, so
-- PRIORITY_CONFLICT_RAISED / PRIORITY_CONFLICT_ACCEPTED need no DDL.
