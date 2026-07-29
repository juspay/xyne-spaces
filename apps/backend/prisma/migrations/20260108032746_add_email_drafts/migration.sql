-- CreateTable
CREATE TABLE "email_drafts" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "draftContent" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_drafts_conversationId_idx" ON "email_drafts"("conversationId");

