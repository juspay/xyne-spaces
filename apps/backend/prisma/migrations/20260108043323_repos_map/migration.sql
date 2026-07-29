-- CreateTable
CREATE TABLE "repos" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "baseBranch" JSONB NOT NULL,
    "prefix" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "repos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "repos_url_key" ON "repos"("url");

-- CreateIndex
CREATE INDEX "repos_name_idx" ON "repos"("name");

