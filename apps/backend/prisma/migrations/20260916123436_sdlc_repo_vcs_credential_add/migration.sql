-- AlterTable
ALTER TABLE "public"."repos" ADD COLUMN     "vcsCredentialId" TEXT;

-- CreateIndex
CREATE INDEX "repos_vcsCredentialId_idx" ON "public"."repos"("vcsCredentialId");

