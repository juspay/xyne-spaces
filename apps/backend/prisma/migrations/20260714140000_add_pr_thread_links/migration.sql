-- Prisma model: PrThreadLink
-- Links a PR to channel threads where its link was posted (e.g. -merge channels).
-- Written when the "Run PR Check" button is posted on a PR-link message; read to
-- mirror PR lifecycle updates (merged, build status) into those threads.
-- Timestamps are supplied by the application (no DB defaults) — the table is
-- written exclusively by backend services via Prisma.

-- CreateTable
CREATE TABLE "non_zero"."pr_thread_links" (
    "id" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "prId" INTEGER NOT NULL,
    "projectKey" TEXT NOT NULL,
    "repositorySlug" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pr_thread_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pr_thread_links_prUrl_conversationId_key" ON "non_zero"."pr_thread_links"("prUrl", "conversationId");

-- CreateIndex
CREATE INDEX "pr_thread_links_prId_idx" ON "non_zero"."pr_thread_links"("prId");

-- CreateIndex
CREATE INDEX "pr_thread_links_conversationId_idx" ON "non_zero"."pr_thread_links"("conversationId");
