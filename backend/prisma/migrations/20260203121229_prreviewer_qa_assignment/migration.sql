-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."ActivityType" ADD VALUE 'PR_REVIEWER';
ALTER TYPE "public"."ActivityType" ADD VALUE 'QA';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."UserResponsibility" ADD VALUE 'PR_REVIEWER';
ALTER TYPE "public"."UserResponsibility" ADD VALUE 'QA';

-- CreateTable
CREATE TABLE "public"."ticket_assignments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userResponsibility" "public"."UserResponsibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "ticket_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_assignments_ticketId_idx" ON "public"."ticket_assignments"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_assignments_userId_idx" ON "public"."ticket_assignments"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_assignments_ticketId_userId_userResponsibility_key" ON "public"."ticket_assignments"("ticketId", "userId", "userResponsibility");
