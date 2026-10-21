-- Radar PR-merge resolution: where PR links were posted, and a fast way to a
-- merged PR's ticket.

-- radar_pr_links: where each pull request link was posted.
--
-- When a PR merges, Radar judges the threads tied to it. Finding those threads
-- by searching chat at merge time grows with the workspace; recording each link
-- as the Radar worker reads it turns the merge-time question into one indexed
-- lookup. Starts empty: links posted before this deploy are not recorded.
CREATE TABLE "non_zero"."radar_pr_links" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "prUrl" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "radar_pr_links_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "radar_pr_links_messageId_prUrl_key"
    ON "non_zero"."radar_pr_links"("messageId", "prUrl");

CREATE INDEX "radar_pr_links_workspaceId_prUrl_idx"
    ON "non_zero"."radar_pr_links"("workspaceId", "prUrl");

-- pull_requests by prUrl: the merge pass finds the PR's ticket this way, and
-- the existing merge-path lookups (prId + prUrl) use it too.
--
-- Not CONCURRENTLY: prisma migrate deploy runs a migration file as one
-- transaction, and CONCURRENTLY cannot run inside one (P3018, which also
-- blocks every later migration). pull_requests is small and written only by
-- PR webhooks, so the brief write lock while this builds is harmless.
CREATE INDEX IF NOT EXISTS "pull_requests_prUrl_idx"
    ON "public"."pull_requests"("prUrl");
