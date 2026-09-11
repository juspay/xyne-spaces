
CREATE TABLE "local_harness_devices" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "deviceName" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "installations" JSONB NOT NULL DEFAULT '[]',
    "lastSeenAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_harness_devices_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "local_harness_devices_tokenHash_key" ON "local_harness_devices"("tokenHash");
CREATE INDEX "local_harness_devices_userId_revokedAt_idx" ON "local_harness_devices"("userId", "revokedAt");

ALTER TABLE "local_harness_devices"
    ADD CONSTRAINT "local_harness_devices_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "local_harness_runs" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT,
    "deviceId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "envelope" JSONB NOT NULL,
    "progressUrl" TEXT NOT NULL,
    "callbackUrl" TEXT NOT NULL,
    "error" TEXT,
    "claimedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_harness_runs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "local_harness_runs_sessionId_key" ON "local_harness_runs"("sessionId");
CREATE INDEX "local_harness_runs_userId_status_createdAt_idx" ON "local_harness_runs"("userId", "status", "createdAt");
CREATE INDEX "local_harness_runs_status_expiresAt_idx" ON "local_harness_runs"("status", "expiresAt");

ALTER TABLE "local_harness_runs"
    ADD CONSTRAINT "local_harness_runs_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "local_harness_runs"
    ADD CONSTRAINT "local_harness_runs_deviceId_fkey"
    FOREIGN KEY ("deviceId") REFERENCES "local_harness_devices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "users" ADD COLUMN "localHarnessDefaultProvider" TEXT;
