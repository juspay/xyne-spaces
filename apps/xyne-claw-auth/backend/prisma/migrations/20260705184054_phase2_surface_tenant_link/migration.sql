-- Phase 2 (§13): surface-tenant → claw-org mapping. ADDITIVE ONLY.
-- Lets JIT place a newly-mirrored user in the correct claw org (via their
-- Spaces workspaceId, represented as the spaces surface tenant id) instead of
-- the hardcoded default — prerequisite for a second tenant sharing one Spaces DB.

-- CreateTable
CREATE TABLE "surface_tenant_links" (
    "id" TEXT NOT NULL,
    "surfaceType" TEXT NOT NULL DEFAULT 'spaces',
    "surfaceTenantId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "surface_tenant_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "surface_tenant_links_surfaceType_surfaceTenantId_key" ON "surface_tenant_links"("surfaceType", "surfaceTenantId");

-- CreateIndex
CREATE INDEX "surface_tenant_links_orgId_idx" ON "surface_tenant_links"("orgId");

-- AddForeignKey
ALTER TABLE "surface_tenant_links" ADD CONSTRAINT "surface_tenant_links_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
