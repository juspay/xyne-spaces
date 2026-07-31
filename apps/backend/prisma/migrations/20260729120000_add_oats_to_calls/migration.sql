-- Extend HEADLESS calls with Oats-specific product data.
ALTER TABLE "public"."calls"
ADD COLUMN "summaryTemplateId" TEXT,
ADD COLUMN "labels" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "markedItems" JSONB[] NOT NULL DEFAULT ARRAY[]::JSONB[];

-- Polymorphic entity sharing for the Oats "note taker" feature. `entityId` is
-- resolved by `shareableEntityType` (currently just NOTE_TAKER -> calls.id).
-- Application code validates polymorphic targets because PostgreSQL cannot
-- express a foreign key across entity types.
-- `shareableEntityType` / `entityUserAccess` are plain TEXT — DB enums are
-- frozen (see scripts/validate-no-new-enums.sh); allowed values are
-- enforced app-side (see apps/backend/src/services/entityAccessService.ts).
CREATE TABLE "public"."entity_access" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "shareableEntityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "userId" TEXT,
    "userGroupId" TEXT,
    "channelId" TEXT,
    "entityUserAccess" TEXT NOT NULL DEFAULT 'VIEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "entity_access_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "entity_access_shareableEntityType_check"
        CHECK ("shareableEntityType" ~ '^[A-Z][A-Z0-9_]*$'),
    CONSTRAINT "entity_access_entityUserAccess_check"
        CHECK ("entityUserAccess" IN ('VIEW', 'EDIT', 'ADMIN', 'REVOKED'))
);

CREATE TABLE "public"."summary_templates" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "autoTriggerPrompt" TEXT,
    "sections" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "systemPrompt" TEXT NOT NULL,
    "defaultOutlet" TEXT NOT NULL DEFAULT 'EMAIL',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "summary_templates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "summary_templates_defaultOutlet_check"
        CHECK ("defaultOutlet" IN ('EMAIL', 'MESSAGE')),
    CONSTRAINT "summary_templates_version_check"
        CHECK ("version" > 0)
);

CREATE UNIQUE INDEX "entity_access_workspaceId_shareableEntityType_entityId_userId_key"
ON "public"."entity_access"("workspaceId", "shareableEntityType", "entityId", "userId");

CREATE INDEX "entity_access_workspaceId_shareableEntityType_entityId_idx"
ON "public"."entity_access"("workspaceId", "shareableEntityType", "entityId");

CREATE INDEX "entity_access_workspaceId_userId_idx"
ON "public"."entity_access"("workspaceId", "userId");

CREATE INDEX "entity_access_workspaceId_userGroupId_idx"
ON "public"."entity_access"("workspaceId", "userGroupId");

CREATE INDEX "entity_access_workspaceId_channelId_idx"
ON "public"."entity_access"("workspaceId", "channelId");

CREATE INDEX "summary_templates_workspaceId_name_idx"
ON "public"."summary_templates"("workspaceId", "name");

CREATE UNIQUE INDEX "summary_templates_workspaceId_name_version_key"
ON "public"."summary_templates"("workspaceId", "name", "version");

CREATE INDEX "calls_summaryTemplateId_idx"
ON "public"."calls"("summaryTemplateId");

CREATE INDEX "calls_headless_owner_startedAt_id_idx"
ON "public"."calls"("workspaceId", "createdByUserId", "startedAt" DESC, "id")
WHERE "callType" = 'HEADLESS';

CREATE INDEX "calls_labels_idx"
ON "public"."calls" USING GIN ("labels");

ALTER TABLE "public"."calls"
ADD CONSTRAINT "calls_summaryTemplateId_fkey"
FOREIGN KEY ("summaryTemplateId")
REFERENCES "public"."summary_templates"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;

