-- CreateTable
CREATE TABLE "gateway_service_requests" (
    "id" TEXT NOT NULL,
    "tenant_unique_id" TEXT NOT NULL,
    "org_id" TEXT,
    "service_name" TEXT NOT NULL,
    "backend_id" TEXT NOT NULL,
    "backend_url" TEXT NOT NULL,
    "token_endpoint_url" TEXT,
    "x_auth_header_name" TEXT,
    "tools" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requested_by_user_id" TEXT NOT NULL,
    "reviewed_by_user_id" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "gateway_service_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "gateway_service_requests_tenant_unique_id_status_idx" ON "gateway_service_requests"("tenant_unique_id", "status");
CREATE INDEX "gateway_service_requests_requested_by_user_id_idx" ON "gateway_service_requests"("requested_by_user_id");
