-- AlterEnum
ALTER TYPE "public"."EmailType" ADD VALUE 'COMPOSE';

-- AlterTable
ALTER TABLE "public"."emails" ADD COLUMN     "sentByUserId" TEXT;

-- CreateIndex
CREATE INDEX "emails_sentByUserId_createdAt_idx" ON "public"."emails"("sentByUserId", "createdAt" DESC);

