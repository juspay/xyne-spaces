-- 1. Create standalone skills table
CREATE TABLE "skills" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'seeded',
    "scope" TEXT NOT NULL DEFAULT 'global',
    "ownerUserId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "promotedBy" TEXT,
    "promotedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "skills_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "skills" ADD CONSTRAINT "skills_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "skills_slug_key" ON "skills"("slug");

-- 2. Migrate existing agent_skills data into standalone skills table (dedup by name)
INSERT INTO "skills" ("id", "slug", "name", "content", "source", "updatedAt")
SELECT DISTINCT ON (name)
    gen_random_uuid()::text,
    lower(replace(replace(name, ' ', '-'), '_', '-')),
    name,
    content,
    'seeded',
    NOW()
FROM "agent_skills"
ON CONFLICT ("slug") DO NOTHING;

-- 3. Create temp mapping of old agent_skills to new skills
CREATE TEMP TABLE _skill_mapping AS
SELECT DISTINCT as2."agentId", s.id AS "skillId"
FROM "agent_skills" as2
JOIN "skills" s ON s.name = as2.name;

-- 4. Drop old agent_skills table
DROP TABLE "agent_skills";

-- 5. Recreate agent_skills as junction table
CREATE TABLE "agent_skills" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    CONSTRAINT "agent_skills_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "agent_skills_agentId_skillId_key" ON "agent_skills"("agentId", "skillId");
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "agent_skills" ADD CONSTRAINT "agent_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 6. Populate junction from mapping
INSERT INTO "agent_skills" ("id", "agentId", "skillId")
SELECT gen_random_uuid()::text, "agentId", "skillId"
FROM _skill_mapping;

DROP TABLE _skill_mapping;

-- 7. Drop user_agent_skills if it exists (no longer needed)
DROP TABLE IF EXISTS "user_agent_skills";

-- 8. Add skill request support to agent_requests
ALTER TABLE "agent_requests" ADD COLUMN IF NOT EXISTS "targetType" TEXT NOT NULL DEFAULT 'agent';
ALTER TABLE "agent_requests" ALTER COLUMN "agentId" DROP NOT NULL;
ALTER TABLE "agent_requests" ALTER COLUMN "agentSlug" DROP NOT NULL;
ALTER TABLE "agent_requests" ADD COLUMN IF NOT EXISTS "skillId" TEXT;
ALTER TABLE "agent_requests" ADD COLUMN IF NOT EXISTS "skillSlug" TEXT;
