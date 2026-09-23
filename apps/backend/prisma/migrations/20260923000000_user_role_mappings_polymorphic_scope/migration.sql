-- Polymorphic scoping for user_role_mappings: entityType/entityId let one table hold
-- both workspace-level and user-group-level role bindings.

-- AlterTable: add scope columns (defaults keep existing rows valid without a nullable phase)
ALTER TABLE "public"."user_role_mappings" ADD COLUMN "entityType" TEXT NOT NULL DEFAULT 'WORKSPACE';
ALTER TABLE "public"."user_role_mappings" ADD COLUMN "entityId" TEXT NOT NULL DEFAULT '';

-- Backfill WORKSPACE scope: every pre-existing row is a direct workspace role,
-- so its scope entityId is the workspaceId. (No copying of user_group_mappings.roleId —
-- group roles are read via union with the legacy column.)
UPDATE "public"."user_role_mappings" SET "entityId" = "workspaceId" WHERE "entityId" = '';

-- Swap the uniqueness constraint from (userId, roleId) to the scoped 4-column key.
DROP INDEX IF EXISTS "public"."user_role_mappings_userId_roleId_key";
CREATE UNIQUE INDEX "user_role_mappings_userId_roleId_entityId_key" ON "public"."user_role_mappings"("userId", "roleId", "entityId");

-- CreateIndex
CREATE INDEX "user_role_mappings_entityType_entityId_idx" ON "public"."user_role_mappings"("entityType", "entityId");
CREATE INDEX "user_role_mappings_roleId_entityType_entityId_idx" ON "public"."user_role_mappings"("roleId", "entityType", "entityId");
