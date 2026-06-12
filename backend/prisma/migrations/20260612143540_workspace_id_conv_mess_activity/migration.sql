-- AlterTable
ALTER TABLE "public"."activities" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."conversations" ADD COLUMN     "workspaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."messages" ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "activities_workspaceId_idx" ON "public"."activities"("workspaceId");

-- CreateIndex
CREATE INDEX "conversations_workspaceId_idx" ON "public"."conversations"("workspaceId");

-- CreateIndex
CREATE INDEX "messages_workspaceId_idx" ON "public"."messages"("workspaceId");
