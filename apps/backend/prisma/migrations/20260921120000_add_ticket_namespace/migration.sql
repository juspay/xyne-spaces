-- AlterTable
ALTER TABLE "public"."boards" ADD COLUMN     "ticketNamespaceId" TEXT;

-- AlterTable
ALTER TABLE "public"."projects" ADD COLUMN     "defaultTicketNamespaceId" TEXT;

-- CreateTable
CREATE TABLE "public"."ticket_namespaces" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "ticketSequence" INTEGER NOT NULL DEFAULT 0,
    "name" TEXT,
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "ticket_namespaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_namespaces_projectId_idx" ON "public"."ticket_namespaces"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "ticket_namespaces_code_workspaceId_key" ON "public"."ticket_namespaces"("code", "workspaceId");

-- CreateIndex
CREATE INDEX "boards_ticketNamespaceId_idx" ON "public"."boards"("ticketNamespaceId");

