-- Create non_zero schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS "non_zero";

-- CreateTable
CREATE TABLE "non_zero"."user_bundle_overrides" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'version',
    "value" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_bundle_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_bundle_overrides_userId_key" ON "non_zero"."user_bundle_overrides"("userId");

-- CreateIndex
CREATE INDEX "user_bundle_overrides_userId_idx" ON "non_zero"."user_bundle_overrides"("userId");

-- CreateIndex
CREATE INDEX "user_bundle_overrides_workspaceId_idx" ON "non_zero"."user_bundle_overrides"("workspaceId");
