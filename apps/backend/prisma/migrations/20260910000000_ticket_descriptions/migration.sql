-- CreateTable
CREATE TABLE "public"."ticket_descriptions" (
    "ticketId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ticket_descriptions_pkey" PRIMARY KEY ("ticketId")
);