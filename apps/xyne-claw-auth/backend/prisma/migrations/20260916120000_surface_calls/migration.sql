ALTER TABLE "local_harness_devices" ADD COLUMN "focusedAt" TIMESTAMP(3);
ALTER TABLE "local_harness_devices" ADD COLUMN "appRoute" TEXT;

CREATE TABLE "surface_calls" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "sessionId" TEXT,
    "toolName" TEXT NOT NULL,
    "args" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "ok" BOOLEAN,
    "content" TEXT,
    "image" JSONB,
    "claimedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "surface_calls_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "surface_calls_deviceId_status_createdAt_idx" ON "surface_calls"("deviceId", "status", "createdAt");
CREATE INDEX "surface_calls_userId_createdAt_idx" ON "surface_calls"("userId", "createdAt");

ALTER TABLE "surface_calls" ADD CONSTRAINT "surface_calls_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "local_harness_devices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
