-- CreateTable
CREATE TABLE "inbox_sources" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "address" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "cursor" TEXT,
    "watchExpiresAt" TIMESTAMP(3),
    "lastPushAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tracked_threads" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "subject" TEXT,
    "participants" JSONB,
    "lastMessageId" TEXT,
    "lastInboundAt" TIMESTAMP(3),
    "lastInboundFrom" TEXT,
    "lastUserReplyAt" TIMESTAMP(3),
    "importance" DOUBLE PRECISION,
    "needsReply" DOUBLE PRECISION,
    "hasDeadline" DOUBLE PRECISION,
    "kind" TEXT,
    "summary" TEXT,
    "state" TEXT NOT NULL DEFAULT 'open',
    "triagedAt" TIMESTAMP(3),
    "extractedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tracked_threads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "open_loops" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "threadId" TEXT,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "ask" TEXT,
    "counterpart" TEXT,
    "deadlineAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "condition" JSONB,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdBy" TEXT NOT NULL,
    "nudgeCount" INTEGER NOT NULL DEFAULT 0,
    "lastNudgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "resolution" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "open_loops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inbox_contacts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "inboundCount" INTEGER NOT NULL DEFAULT 0,
    "userReplyCount" INTEGER NOT NULL DEFAULT 0,
    "avgReplyMins" DOUBLE PRECISION,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "lastInboundAt" TIMESTAMP(3),
    "lastUserReplyAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inbox_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nudge_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "loopId" TEXT NOT NULL,
    "agentId" TEXT,
    "decision" TEXT NOT NULL,
    "reason" TEXT,
    "shadow" BOOLEAN NOT NULL DEFAULT false,
    "channel" TEXT,
    "runId" TEXT,
    "sentAt" TIMESTAMP(3),
    "reaction" TEXT,
    "reactedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nudge_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proactive_prefs" (
    "userId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "agentId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "quietStartHour" INTEGER NOT NULL DEFAULT 22,
    "quietEndHour" INTEGER NOT NULL DEFAULT 8,
    "maxNudgesPerDay" INTEGER NOT NULL DEFAULT 3,
    "replySlaHours" INTEGER NOT NULL DEFAULT 24,
    "mutedContacts" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "proactive_prefs_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "inbox_sources_kind_address_idx" ON "inbox_sources"("kind", "address");

-- CreateIndex
CREATE INDEX "inbox_sources_enabled_watchExpiresAt_idx" ON "inbox_sources"("enabled", "watchExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_sources_userId_kind_key" ON "inbox_sources"("userId", "kind");

-- CreateIndex
CREATE INDEX "tracked_threads_userId_state_lastInboundAt_idx" ON "tracked_threads"("userId", "state", "lastInboundAt");

-- CreateIndex
CREATE INDEX "tracked_threads_sourceId_idx" ON "tracked_threads"("sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "tracked_threads_userId_source_externalId_key" ON "tracked_threads"("userId", "source", "externalId");

-- CreateIndex
CREATE INDEX "open_loops_status_dueAt_idx" ON "open_loops"("status", "dueAt");

-- CreateIndex
CREATE INDEX "open_loops_userId_status_idx" ON "open_loops"("userId", "status");

-- CreateIndex
CREATE INDEX "open_loops_threadId_idx" ON "open_loops"("threadId");

-- CreateIndex
CREATE UNIQUE INDEX "inbox_contacts_userId_key_key" ON "inbox_contacts"("userId", "key");

-- CreateIndex
CREATE INDEX "nudge_logs_userId_createdAt_idx" ON "nudge_logs"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "nudge_logs_loopId_idx" ON "nudge_logs"("loopId");

-- AddForeignKey
ALTER TABLE "inbox_sources" ADD CONSTRAINT "inbox_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_threads" ADD CONSTRAINT "tracked_threads_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tracked_threads" ADD CONSTRAINT "tracked_threads_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "inbox_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_loops" ADD CONSTRAINT "open_loops_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "open_loops" ADD CONSTRAINT "open_loops_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "tracked_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inbox_contacts" ADD CONSTRAINT "inbox_contacts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nudge_logs" ADD CONSTRAINT "nudge_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nudge_logs" ADD CONSTRAINT "nudge_logs_loopId_fkey" FOREIGN KEY ("loopId") REFERENCES "open_loops"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proactive_prefs" ADD CONSTRAINT "proactive_prefs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

