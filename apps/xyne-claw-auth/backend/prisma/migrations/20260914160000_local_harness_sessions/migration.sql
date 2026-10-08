-- CreateTable
CREATE TABLE "local_harness_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "cliSessionId" TEXT NOT NULL,
    "storagePath" TEXT,
    "sizeBytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "local_harness_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "local_harness_sessions_conversationId_provider_key" ON "local_harness_sessions"("conversationId", "provider");

-- CreateIndex
CREATE INDEX "local_harness_sessions_userId_updatedAt_idx" ON "local_harness_sessions"("userId", "updatedAt");

-- AddForeignKey
ALTER TABLE "local_harness_sessions" ADD CONSTRAINT "local_harness_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "chat_messages" ADD COLUMN "runProvider" TEXT;
