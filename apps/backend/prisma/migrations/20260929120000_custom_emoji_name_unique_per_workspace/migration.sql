-- DropIndex
DROP INDEX "public"."custom_emojis_name_key";

-- CreateIndex
CREATE UNIQUE INDEX "custom_emojis_workspaceId_name_key" ON "public"."custom_emojis"("workspaceId", "name");

