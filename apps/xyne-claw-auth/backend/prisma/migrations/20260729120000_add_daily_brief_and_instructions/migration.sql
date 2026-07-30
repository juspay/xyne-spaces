-- Daily Brief feature.
-- New Prisma models created below: UserAgentInstruction, GeneratedContent.
-- (Model names referenced here so schema-migration validation can match them to
--  their @@map'd tables user_agent_instructions / generated_content.)

-- CreateTable: UserAgentInstruction — per-user, per-agent custom instructions.
CREATE TABLE "user_agent_instructions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT NOT NULL,
    "instructions" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "user_agent_instructions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: GeneratedContent — generic feature-generated content (first consumer: Daily Brief).
CREATE TABLE "generated_content" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentSlug" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'DAILY_BRIEF',
    "dateBucket" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "data" JSONB,
    "status" TEXT NOT NULL DEFAULT 'generating',
    "sessionId" TEXT,
    "generatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "orgId" TEXT NOT NULL,

    CONSTRAINT "generated_content_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_agent_instructions_userId_orgId_agentSlug_key" ON "user_agent_instructions"("userId", "orgId", "agentSlug");
CREATE INDEX "user_agent_instructions_orgId_idx" ON "user_agent_instructions"("orgId");
CREATE INDEX "user_agent_instructions_userId_idx" ON "user_agent_instructions"("userId");

CREATE UNIQUE INDEX "generated_content_userId_kind_dateBucket_key" ON "generated_content"("userId", "kind", "dateBucket");
CREATE INDEX "generated_content_orgId_idx" ON "generated_content"("orgId");
CREATE INDEX "generated_content_userId_kind_dateBucket_idx" ON "generated_content"("userId", "kind", "dateBucket");
CREATE INDEX "generated_content_status_kind_idx" ON "generated_content"("status", "kind");

-- AddForeignKey
ALTER TABLE "user_agent_instructions" ADD CONSTRAINT "user_agent_instructions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "generated_content" ADD CONSTRAINT "generated_content_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: additive Daily Brief columns on the EXISTING users + organizations
-- tables (they pre-date this feature, so these columns must be ALTER-added — they
-- cannot live in a CREATE TABLE).
ALTER TABLE "users" ADD COLUMN "dailyBriefEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "dailyBriefEnabledAt" TIMESTAMP(3);
ALTER TABLE "organizations" ADD COLUMN "dailyBriefAgentSlug" TEXT;
