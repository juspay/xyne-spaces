-- CreateTable
CREATE TABLE "daily_brief_activity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "dateBucket" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "rejectionCount" INTEGER NOT NULL DEFAULT 0,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "daily_brief_activity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_brief_activity_userId_kind_dateBucket_key" ON "daily_brief_activity"("userId", "kind", "dateBucket");

-- CreateIndex
CREATE INDEX "daily_brief_activity_orgId_idx" ON "daily_brief_activity"("orgId");

-- CreateIndex
CREATE INDEX "daily_brief_activity_kind_dateBucket_idx" ON "daily_brief_activity"("kind", "dateBucket");

-- AddForeignKey
ALTER TABLE "daily_brief_activity" ADD CONSTRAINT "daily_brief_activity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
