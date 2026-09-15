-- CreateTable
CREATE TABLE "non_zero"."execution_items" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "sourceMessageId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "contextSummary" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    -- NOT NULL is load-bearing: a NULL array makes "pendingOn" @> ARRAY[me]
    -- evaluate to NULL rather than false, so the row would silently vanish
    -- from BOTH feeds -- including the NOT(...) branch of Waiting On, breaking
    -- the "an ownerless item stays in its requester's Waiting On" rule.
    "requestedBy" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "pendingOn" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "execution_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."execution_thread_states" (
    "workspaceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "watermarkCreatedAt" TIMESTAMP(3) NOT NULL,
    "watermarkMsgId" TEXT NOT NULL,
    -- Consecutive parser failures on the window above the watermark. A failed
    -- parse deliberately leaves the watermark put, so without this a window the
    -- parser can never handle would be re-parsed by every later message.
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "execution_thread_states_pkey" PRIMARY KEY ("conversationId")
);

-- CreateTable
CREATE TABLE "non_zero"."execution_item_mutations" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "op" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorId" TEXT,
    "sourceMessageId" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_item_mutations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."execution_run_logs" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "gatePassed" BOOLEAN NOT NULL,
    "gateReason" TEXT NOT NULL,
    "windowSize" INTEGER NOT NULL,
    "parserRan" BOOLEAN NOT NULL DEFAULT false,
    "proposedOps" JSONB,
    "validOps" JSONB,
    "droppedOps" JSONB,
    "applied" JSONB,
    "assessment" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "execution_run_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."radar_teams" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "memberIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radar_teams_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "execution_items_conversationId_status_idx" ON "non_zero"."execution_items"("conversationId", "status");



-- CreateIndex
CREATE INDEX "execution_items_pendingOn_idx" ON "non_zero"."execution_items" USING GIN ("pendingOn");

-- CreateIndex
CREATE INDEX "execution_items_requestedBy_idx" ON "non_zero"."execution_items" USING GIN ("requestedBy");



-- CreateIndex
CREATE INDEX "execution_item_mutations_itemId_createdAt_idx" ON "non_zero"."execution_item_mutations"("itemId", "createdAt");



-- CreateIndex
CREATE INDEX "execution_run_logs_conversationId_createdAt_idx" ON "non_zero"."execution_run_logs"("conversationId", "createdAt");


-- CreateIndex
-- Serves the retention sweep, which filters on createdAt alone and so cannot
-- use either composite index above.
CREATE INDEX "execution_run_logs_createdAt_idx" ON "non_zero"."execution_run_logs"("createdAt");

-- CreateIndex
CREATE INDEX "radar_teams_workspaceId_ownerId_idx" ON "non_zero"."radar_teams"("workspaceId", "ownerId");
