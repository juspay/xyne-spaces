-- CreateTable — Prisma model: AppCollaborator (@@map "app_collaborators", @@schema "public").
-- Lives in "public" so it syncs via Zero (Zero mirrors the "public" schema).
-- No FK constraints — repo uses relationMode = "prisma" (relations are logical only).
-- collaboratorType is a plain TEXT column ('ADMIN' | 'CONTRIBUTOR'), not a DB enum,
-- so adding a value needs zero DB migration; values are validated app-side.
CREATE TABLE "public"."app_collaborators" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "collaboratorType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_collaborators_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "app_collaborators_appId_userId_key" ON "public"."app_collaborators"("appId", "userId");

-- CreateIndex
CREATE INDEX "app_collaborators_userId_idx" ON "public"."app_collaborators"("userId");

-- CreateIndex
CREATE INDEX "app_collaborators_workspaceId_idx" ON "public"."app_collaborators"("workspaceId");
