-- Polymorphic scoping for user_role_mappings: entityType/entityId let one table hold
-- both workspace-level and user-group-level role bindings.

ALTER TABLE "public"."user_role_mappings" ADD COLUMN "entityType" TEXT;
ALTER TABLE "public"."user_role_mappings" ADD COLUMN "entityId" TEXT;

DROP INDEX IF EXISTS "public"."user_role_mappings_userId_roleId_key";
CREATE UNIQUE INDEX "user_role_mappings_userId_roleId_entityId_key" ON "public"."user_role_mappings"("userId", "roleId", "entityId");

-- CreateIndex
CREATE INDEX "user_role_mappings_entityType_entityId_idx" ON "public"."user_role_mappings"("entityType", "entityId");
CREATE INDEX "user_role_mappings_roleId_entityType_entityId_idx" ON "public"."user_role_mappings"("roleId", "entityType", "entityId");
