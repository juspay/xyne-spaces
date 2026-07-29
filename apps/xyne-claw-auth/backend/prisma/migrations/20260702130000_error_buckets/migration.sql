-- Error-pipeline bucket taxonomy + routing rules (Grafana → Claw auto-fix)
CREATE TABLE "error_buckets" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markers" TEXT NOT NULL DEFAULT '',
    "matchOrder" INTEGER NOT NULL DEFAULT 20,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "error_buckets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "error_buckets_name_key" ON "error_buckets"("name");
CREATE INDEX "error_buckets_enabled_matchOrder_idx" ON "error_buckets"("enabled", "matchOrder");
