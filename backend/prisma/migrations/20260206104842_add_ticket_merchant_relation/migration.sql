-- CreateTable
CREATE TABLE IF NOT EXISTS "merchants" (
    "id" TEXT NOT NULL,
    "mid" TEXT NOT NULL,

    CONSTRAINT "merchants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "merchants_mid_key" ON "merchants"("mid");

-- CreateIndex for compound indexes on tickets table
CREATE INDEX IF NOT EXISTS "tickets_merchantId_createdAt_idx" ON "tickets"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "tickets_channelId_merchantId_idx" ON "tickets"("channelId", "merchantId");
