-- AI thread summary per desk ticket, used for related-ticket matching.
CREATE TABLE "non_zero"."ticket_summaries" (
    "ticketId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "channelConnectId" TEXT,
    "summary" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_summaries_pkey" PRIMARY KEY ("ticketId")
);

CREATE INDEX "ticket_summaries_workspaceId_idx" ON "non_zero"."ticket_summaries"("workspaceId");
CREATE INDEX "ticket_summaries_channelId_idx" ON "non_zero"."ticket_summaries"("channelId");
CREATE INDEX "ticket_summaries_channelConnectId_idx" ON "non_zero"."ticket_summaries"("channelConnectId");
