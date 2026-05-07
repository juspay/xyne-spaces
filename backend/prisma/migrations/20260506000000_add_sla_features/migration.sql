-- =============================================================================
-- SLA feature set — single consolidated migration
--
-- Changes applied:
--   1. Create board_sla_policies — per-board, per-priority SLA configuration.
--   2. Add tickets.firstRespondedAt — set once when an agent first replies;
--      used to compute first-response SLA performance.
--   3. Add email_channel_preferences.defaultCc — comma-separated list of
--      addresses pre-populated in the CC field when composing a new email.
-- =============================================================================

-- ----------------------------------------------------------------------------
-- 1. board_sla_policies
-- SLA policies are defined per board and per priority level.
-- When a board's metadata.slaPolicyType is 'priority', these rows are used
-- to compute response/resolution deadlines for tickets at creation time.
-- responseHours / resolutionHours may be calendar hours (businessHoursOnly=false)
-- or business hours (businessHoursOnly=true, Mon–Fri workdayStart–workdayEnd in
-- the configured IANA timezone).
-- ----------------------------------------------------------------------------
CREATE TABLE "public"."board_sla_policies" (
    "id"                TEXT             NOT NULL,
    "boardId"           TEXT             NOT NULL,
    "priority"          "public"."TicketPriority" NOT NULL,
    "responseHours"     DOUBLE PRECISION NOT NULL,
    "resolutionHours"   DOUBLE PRECISION NOT NULL,
    "businessHoursOnly" BOOLEAN          NOT NULL DEFAULT true,
    "timezone"          TEXT             NOT NULL DEFAULT 'UTC',
    "workdayStart"      INTEGER          NOT NULL DEFAULT 9,
    "workdayEnd"        INTEGER          NOT NULL DEFAULT 18,
    "isActive"          BOOLEAN          NOT NULL DEFAULT true,
    "createdAt"         TIMESTAMP(3)     NOT NULL,
    "updatedAt"         TIMESTAMP(3)     NOT NULL,

    CONSTRAINT "board_sla_policies_pkey" PRIMARY KEY ("id")
);

-- Enforce one policy per (board, priority) combination.
CREATE UNIQUE INDEX "board_sla_policies_boardId_priority_key"
    ON "public"."board_sla_policies"("boardId", "priority");

CREATE INDEX "board_sla_policies_boardId_idx"
    ON "public"."board_sla_policies"("boardId");

CREATE INDEX "board_sla_policies_isActive_idx"
    ON "public"."board_sla_policies"("isActive");

-- ----------------------------------------------------------------------------
-- 2. tickets.firstRespondedAt
-- Tracks the timestamp of the first outbound agent reply.
-- Set once and never overwritten; used to compute first-response SLA
-- performance ("Responded in Xh Ym").
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."tickets"
    ADD COLUMN "firstRespondedAt" TIMESTAMP(3);

-- ----------------------------------------------------------------------------
-- 3. email_channel_preferences.defaultCc
-- Optional comma-separated list of email addresses to pre-populate the CC
-- field when composing a new email from this desk channel.
-- ----------------------------------------------------------------------------
ALTER TABLE "public"."email_channel_preferences"
    ADD COLUMN "defaultCc" TEXT;
