-- MCP Gateway registry table

CREATE TABLE "service_registry" (
  "id" TEXT NOT NULL,
  "tenant_id" TEXT NOT NULL,
  "tenant_unique_id" TEXT NOT NULL,
  "service_name" TEXT NOT NULL,
  "backend_id" TEXT NOT NULL,
  "backend_url" TEXT NOT NULL,
  "tools" JSONB NOT NULL,
  "x_auth_header_name" TEXT,
  "token_endpoint_url" TEXT,
  "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "service_registry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "unique_service_backend_tenant" ON "service_registry"("tenant_unique_id", "service_name", "backend_id");
CREATE INDEX "service_registry_tenant_unique_id_idx" ON "service_registry"("tenant_unique_id");
CREATE INDEX "service_registry_service_name_idx" ON "service_registry"("service_name");
CREATE INDEX "service_registry_tenant_unique_id_service_name_idx" ON "service_registry"("tenant_unique_id", "service_name");
