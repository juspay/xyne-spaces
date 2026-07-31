CREATE TYPE "non_zero"."TelepresenceDeviceType" AS ENUM ('TV', 'CAMERA', 'MICROPHONE', 'SPEAKER');

CREATE TYPE "non_zero"."TelepresenceHealthStatus" AS ENUM ('HEALTHY', 'DEGRADED', 'UNAVAILABLE', 'UNKNOWN');

CREATE TABLE "non_zero"."telepresence_health_view" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceType" "non_zero"."TelepresenceDeviceType" NOT NULL,
  "name" TEXT NOT NULL,
  "status" "non_zero"."TelepresenceHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  "connected" INT NOT NULL,
  "detected" INT NOT NULL,
  "cpuTemperature" DOUBLE PRECISION NOT NULL,
  "lastReportedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "telepresence_health_view_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "telepresence_health_view_userId_deviceType_name_key" ON "non_zero"."telepresence_health_view"("userId", "deviceType", "name");

CREATE TABLE "non_zero"."telepresence_health_log" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "deviceType" "non_zero"."TelepresenceDeviceType" NOT NULL,
  "name" TEXT,
  "status" "non_zero"."TelepresenceHealthStatus" NOT NULL DEFAULT 'UNKNOWN',
  "connected" INT NOT NULL,
  "detected" INT NOT NULL,
  "cpuTemperature" DOUBLE PRECISION NOT NULL,
  "description" TEXT,
  "reportedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "telepresence_health_log_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "telepresence_health_log_userId_reportedAt_idx" ON "non_zero"."telepresence_health_log"("userId", "reportedAt");

CREATE INDEX "telepresence_health_log_userId_deviceType_reportedAt_idx" ON "non_zero"."telepresence_health_log"("userId", "deviceType", "reportedAt");
