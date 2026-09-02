-- CreateTable: Commit table for bot attribution tracking
CREATE TABLE "public"."commits" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "commitSha" TEXT NOT NULL,
    "pullRequestId" TEXT NOT NULL,
    "repositoryUrl" TEXT NOT NULL,
    "agentSlug" TEXT,
    "authorName" TEXT NOT NULL,
    "authorEmail" TEXT NOT NULL,
    "messageHeadline" TEXT NOT NULL,
    "messageBody" TEXT,
    "committedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "commits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "commits_pullRequestId_commitSha_key" ON "public"."commits"("pullRequestId", "commitSha");

-- CreateIndex
CREATE INDEX "commits_pullRequestId_idx" ON "public"."commits"("pullRequestId");

-- CreateIndex
CREATE INDEX "commits_workspaceId_idx" ON "public"."commits"("workspaceId");

-- CreateIndex
CREATE INDEX "commits_workspaceId_repositoryUrl_committedAt_idx" ON "public"."commits"("workspaceId", "repositoryUrl", "committedAt" DESC);

-- AddForeignKey
ALTER TABLE "public"."commits" ADD CONSTRAINT "commits_pullRequestId_fkey" FOREIGN KEY ("pullRequestId") REFERENCES "public"."pull_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Add bot commit tracking fields to pull_requests
ALTER TABLE "public"."pull_requests" ADD COLUMN "botCommitCount" INTEGER,
ADD COLUMN "humanCommitCount" INTEGER,
ADD COLUMN "unknownCommitCount" INTEGER,
ADD COLUMN "commitAnalysisStatus" TEXT,
ADD COLUMN "commitAnalysisError" TEXT,
ADD COLUMN "commitAnalyzedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "pull_requests_commitAnalysisStatus_idx" ON "public"."pull_requests"("commitAnalysisStatus");
