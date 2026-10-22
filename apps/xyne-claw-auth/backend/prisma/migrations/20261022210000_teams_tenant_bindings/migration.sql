-- Microsoft Entra tenant → org binding for the Teams channel (XYNE-66905).
--
-- A Teams message is accepted only from a tenant an org admin bound to the
-- account's org, and its sender is only ever matched to a user of that org.
-- One tenant belongs to one org, hence the unique tenantId.

-- CreateTable
CREATE TABLE "teams_tenant_bindings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "boundByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "teams_tenant_bindings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "teams_tenant_bindings_tenantId_key" ON "teams_tenant_bindings"("tenantId");

-- CreateIndex
CREATE INDEX "teams_tenant_bindings_orgId_idx" ON "teams_tenant_bindings"("orgId");
