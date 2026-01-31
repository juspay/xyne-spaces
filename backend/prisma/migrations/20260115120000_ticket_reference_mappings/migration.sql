-- CreateEnum
CREATE TYPE "TicketReferenceRelation" AS ENUM ('LINKED', 'DUPLICATE_CONFIRMED', 'DUPLICATE_POSSIBLE');

-- CreateTable
CREATE TABLE "ticket_reference_mappings" (
    "id" TEXT NOT NULL,
    "sourceTicketId" TEXT NOT NULL,
    "targetTicketId" TEXT NOT NULL,
    "relationType" "TicketReferenceRelation" NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_reference_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_reference_mappings_sourceTicketId_idx" ON "ticket_reference_mappings"("sourceTicketId");

-- CreateIndex
CREATE INDEX "ticket_reference_mappings_targetTicketId_idx" ON "ticket_reference_mappings"("targetTicketId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_reference_mappings_sourceTicketId_targetTicketId_relationType_key" ON "ticket_reference_mappings"("sourceTicketId", "targetTicketId", "relationType");
