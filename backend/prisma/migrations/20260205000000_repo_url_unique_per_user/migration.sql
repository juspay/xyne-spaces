-- DropIndex
DROP INDEX IF EXISTS "repos_url_key";

-- CreateIndex
CREATE UNIQUE INDEX "repos_url_createdBy_key" ON "repos"("url", "createdBy");
