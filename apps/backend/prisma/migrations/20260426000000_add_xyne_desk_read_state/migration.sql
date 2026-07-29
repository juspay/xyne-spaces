-- Prisma model: EmailRead
-- CreateTable
CREATE TABLE "public"."email_reads" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "lastReadEmailId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_reads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "email_reads_userId_idx" ON "public"."email_reads"("userId");

-- CreateIndex
CREATE INDEX "email_reads_ticketId_idx" ON "public"."email_reads"("ticketId");

-- CreateIndex
CREATE UNIQUE INDEX "email_reads_ticketId_userId_key" ON "public"."email_reads"("ticketId", "userId");

-- AlterTable
ALTER TABLE "public"."tickets" ADD COLUMN     "lastEmailAt" TIMESTAMP(3) NOT NULL;

-- CreateIndex
CREATE INDEX "tickets_lastEmailAt_idx" ON "public"."tickets"("lastEmailAt");
