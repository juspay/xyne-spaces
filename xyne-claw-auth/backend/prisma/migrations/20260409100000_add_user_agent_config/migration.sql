-- CreateTable
CREATE TABLE "user_agent_configs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'spaces',
    "encryptedKey" TEXT,
    "iv" TEXT,
    "authTag" TEXT,
    "model" TEXT,
    "baseUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_agent_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_agent_configs_userId_agentSlug_key" ON "user_agent_configs"("userId", "agentSlug");

-- AddForeignKey
ALTER TABLE "user_agent_configs" ADD CONSTRAINT "user_agent_configs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
