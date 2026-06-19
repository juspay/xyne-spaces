-- Add non-linear board support, form versioning, and form submission history

-- 1. Extend BoardType enum
ALTER TYPE "public"."BoardType" ADD VALUE 'NON_LINEAR';

-- 2. Create VisitSlaMode enum
CREATE TYPE "public"."VisitSlaMode" AS ENUM ('STAGE_DEFAULT', 'NONE', 'FIXED_HOURS');

-- 3. Create ReenterMode enum
CREATE TYPE "public"."ReenterMode" AS ENUM ('RESET', 'CONTINUE');

-- 4. Create ApproverType enum
CREATE TYPE "public"."ApproverType" AS ENUM ('USER', 'ROLE');

-- 5. Add visit version tracking to ticket_stage_eta
-- Nullable, no DB default: avoids a blocking rewrite/lock on the existing table in prod.
-- Application code treats NULL as version 1 (see TicketStageEta usages).
ALTER TABLE "public"."ticket_stage_eta" ADD COLUMN "version" INTEGER;
CREATE INDEX "ticket_stage_eta_ticketId_stageId_version_idx" ON "public"."ticket_stage_eta"("ticketId", "stageId", "version");

-- 6. Create stage_transitions table (Prisma model: StageTransition)
CREATE TABLE "public"."stage_transitions" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "fromStageId" TEXT,
    "toStageId" TEXT NOT NULL,
    "formId" TEXT,
    -- Nullable, no DB defaults: application code supplies defaults and treats NULL as
    -- requiresApproval=false, bypassApprovalForAutomation=false,
    -- visitSlaMode=STAGE_DEFAULT, onReenter=RESET (see StageTransition usages).
    "requiresApproval" BOOLEAN,
    "bypassApprovalForAutomation" BOOLEAN,
    "visitSlaMode" "public"."VisitSlaMode",
    "fixedEtaHours" INTEGER,
    "onReenter" "public"."ReenterMode",
    "createdAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stage_transitions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stage_transitions_boardId_fromStageId_toStageId_key" ON "public"."stage_transitions"("boardId", "fromStageId", "toStageId");
CREATE INDEX "stage_transitions_boardId_idx" ON "public"."stage_transitions"("boardId");
CREATE INDEX "stage_transitions_fromStageId_idx" ON "public"."stage_transitions"("fromStageId");
CREATE INDEX "stage_transitions_boardId_toStageId_idx" ON "public"."stage_transitions"("boardId", "toStageId");
CREATE INDEX "stage_transitions_toStageId_idx" ON "public"."stage_transitions"("toStageId");

-- 7. Extend stage_approvers to also hold NON_LINEAR transition approvers (Prisma model: StageApprovers)
--    Linear boards key approvers by stageId; NON_LINEAR boards key them by transitionId.
--    userId is set when approverType = USER; roleId is set when approverType = ROLE.
-- Nullable, no DB default: avoids a blocking rewrite/lock on the existing table in prod.
-- Application code treats NULL as ApproverType.USER (see StageApprovers usages).
ALTER TABLE "public"."stage_approvers" ADD COLUMN "approverType" "public"."ApproverType";
ALTER TABLE "public"."stage_approvers" ADD COLUMN "transitionId" TEXT;
ALTER TABLE "public"."stage_approvers" ADD COLUMN "roleId" TEXT;
ALTER TABLE "public"."stage_approvers" ALTER COLUMN "stageId" DROP NOT NULL;
ALTER TABLE "public"."stage_approvers" ALTER COLUMN "userId" DROP NOT NULL;

DROP INDEX IF EXISTS "public"."stage_approvers_stageId_userId_key";
CREATE UNIQUE INDEX "stage_approvers_stageId_userId_approverType_key" ON "public"."stage_approvers"("stageId", "userId", "approverType");
CREATE UNIQUE INDEX "stage_approvers_transitionId_userId_approverType_key" ON "public"."stage_approvers"("transitionId", "userId", "approverType");
CREATE UNIQUE INDEX "stage_approvers_stageId_roleId_approverType_key" ON "public"."stage_approvers"("stageId", "roleId", "approverType");
CREATE UNIQUE INDEX "stage_approvers_transitionId_roleId_approverType_key" ON "public"."stage_approvers"("transitionId", "roleId", "approverType");
CREATE INDEX "stage_approvers_transitionId_idx" ON "public"."stage_approvers"("transitionId");

ALTER TABLE "public"."stage_approvers" ADD CONSTRAINT "stage_approvers_transitionId_fkey" FOREIGN KEY ("transitionId") REFERENCES "public"."stage_transitions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 8. Add version to form_entity_values for preserving submissions across revisits
-- Nullable, no DB default: avoids a blocking rewrite/lock on the existing table in prod.
-- Application code treats NULL as version 1 (see FormEntityValues usages).
ALTER TABLE "public"."form_entity_values" ADD COLUMN "version" INTEGER;
DROP INDEX IF EXISTS "form_entity_values_entityId_entityType_fieldId_contextId_key";
CREATE UNIQUE INDEX "form_entity_values_entityId_entityType_fieldId_contextId_version_key" ON "public"."form_entity_values"("entityId", "entityType", "fieldId", "contextId", "version");
