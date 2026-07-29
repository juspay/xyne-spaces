-- CreateEnum
CREATE TYPE "DocType" AS ENUM ('Canvas', 'Quarto');

-- AlterTable
ALTER TABLE "canvases" ADD COLUMN     "branchName" TEXT,
ADD COLUMN     "docType" "DocType" NOT NULL DEFAULT 'Canvas',
ADD COLUMN     "entryFile" TEXT,
ADD COLUMN     "gcsPath" TEXT,
ADD COLUMN     "quartoDocumentType" TEXT,
ADD COLUMN     "repoId" TEXT,
ADD COLUMN     "userRepo" TEXT;

-- CreateIndex
CREATE INDEX "canvases_docType_idx" ON "canvases"("docType");

-- CreateIndex
CREATE UNIQUE INDEX "canvases_userRepo_key" ON "canvases"("userRepo");

-- CreateIndex
CREATE UNIQUE INDEX "canvases_repoId_branchName_key" ON "canvases"("repoId", "branchName");

