-- CreateTable
CREATE TABLE "public"."ticket_stage_eta" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "stageEnteredAt" TIMESTAMP(3) NOT NULL,
    "stageLeftAt" TIMESTAMP(3),
    "stageEta" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_stage_eta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_stage_eta_ticketId_idx" ON "public"."ticket_stage_eta"("ticketId");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_ticketId_stageId_idx" ON "public"."ticket_stage_eta"("ticketId", "stageId");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_stageLeftAt_idx" ON "public"."ticket_stage_eta"("stageLeftAt");

-- CreateIndex
CREATE INDEX "ticket_stage_eta_stageEta_idx" ON "public"."ticket_stage_eta"("stageEta");
