-- AlterEnum
ALTER TYPE "public"."BoardType" ADD VALUE 'FLOW';

-- AlterTable
ALTER TABLE "public"."boards" ADD COLUMN     "flowPlan" TEXT;

-- AlterTable
ALTER TABLE "public"."tickets" ADD COLUMN     "rootId" TEXT;

-- CreateIndex
CREATE INDEX CONCURRENTLY "tickets_rootId_idx" ON "public"."tickets"("rootId") WHERE "rootId" IS NOT NULL;
