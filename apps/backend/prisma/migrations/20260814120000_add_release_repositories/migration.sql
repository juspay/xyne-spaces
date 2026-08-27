-- Per (release ticket × main release board/repo) commit range. Absence of rows
-- for a release means single-repo legacy mode (range read from the ticket form).

-- CreateTable
CREATE TABLE "non_zero"."release_repositories" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "mainReleaseBoardId" TEXT NOT NULL,
    "branch" TEXT NOT NULL,
    "deployedCommit" TEXT NOT NULL,
    "newCommit" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "release_repositories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "release_repositories_releaseId_idx"
    ON "non_zero"."release_repositories"("releaseId");

-- CreateIndex
CREATE INDEX "release_repositories_releaseId_createdAt_id_idx"
    ON "non_zero"."release_repositories"("releaseId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "release_repositories_releaseId_mainReleaseBoardId_key"
    ON "non_zero"."release_repositories"("releaseId", "mainReleaseBoardId");
