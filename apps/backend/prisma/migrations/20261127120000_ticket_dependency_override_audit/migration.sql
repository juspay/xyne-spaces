-- Override reasons can mention restricted tickets. Never replicate them with CHILD mappings.
CREATE TABLE "non_zero"."ticket_dependency_overrides" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "ticketId" TEXT NOT NULL,
  "edgeId" TEXT NOT NULL,
  "edgeKind" TEXT NOT NULL,
  "actorId" TEXT,
  "action" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ticket_dependency_overrides_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ticket_dependency_overrides_workspaceId_ticketId_createdAt_idx"
  ON "non_zero"."ticket_dependency_overrides" ("workspaceId", "ticketId", "createdAt");

-- Preserve any early/test rollout reasons privately before removing them from replicated rows.
INSERT INTO "non_zero"."ticket_dependency_overrides"
  ("id", "workspaceId", "ticketId", "edgeId", "edgeKind", "actorId", "action", "reason", "createdAt")
SELECT md5('legacy-child-override:' || "id"), "workspaceId", "ticketId", "id", 'CHILD',
  "overriddenBy", 'LEGACY_OVERRIDE', COALESCE("overrideReason", ''), COALESCE("overriddenAt", CURRENT_TIMESTAMP)
FROM "public"."ticket_sub_ticket_mappings" WHERE "overrideReason" IS NOT NULL OR "overriddenBy" IS NOT NULL;
UPDATE "public"."ticket_sub_ticket_mappings" SET "overrideReason" = NULL, "overriddenBy" = NULL WHERE "overrideReason" IS NOT NULL OR "overriddenBy" IS NOT NULL;
