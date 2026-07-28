-- AlterEnum
ALTER TYPE "public"."OrgRole" ADD VALUE 'GUEST';

-- AlterTable
ALTER TABLE "public"."invitations" ADD COLUMN     "entityId" TEXT,
ADD COLUMN     "entityType" TEXT,
ADD COLUMN     "channelId" TEXT;

-- CreateTable
CREATE TABLE "public"."guest_access" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "accessibleEntityId" TEXT NOT NULL,
    "accessibleEntityType" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guest_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "guest_access_workspaceId_userId_idx" ON "public"."guest_access"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "guest_access_userId_accessibleEntityId_accessibleEntityType_key" ON "public"."guest_access"("userId", "accessibleEntityId", "accessibleEntityType");

-- CreateIndex
CREATE INDEX "invitations_entityId_idx" ON "public"."invitations"("entityId");
