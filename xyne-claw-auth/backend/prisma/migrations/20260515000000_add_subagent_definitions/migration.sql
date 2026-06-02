-- User-created subagent definitions. Built-in subagents stay in code
-- (xyne-claw-shared SUBAGENT_DEFINITIONS); this table is for net-new
-- subagents only. CRUD-route validation rejects names that collide with
-- built-ins at write time so the runtime resolver can prefer built-ins
-- on lookup without ambiguity.

CREATE TABLE "subagent_definitions" (
  "id"                TEXT PRIMARY KEY,
  "name"              TEXT NOT NULL UNIQUE,
  "description"       TEXT NOT NULL,
  "progressLabels"    JSONB NOT NULL,
  "systemPrompt"      TEXT NOT NULL,
  "paramName"         TEXT NOT NULL DEFAULT 'question',
  "paramDescription"  TEXT NOT NULL,
  "tools"             JSONB NOT NULL,
  "enabled"           BOOLEAN NOT NULL DEFAULT TRUE,
  "createdByUserId"   TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE TABLE "subagent_skills" (
  "id"                   TEXT PRIMARY KEY,
  "subagentDefinitionId" TEXT NOT NULL,
  "skillId"              TEXT NOT NULL,
  CONSTRAINT "subagent_skills_subagentDefinitionId_fkey"
    FOREIGN KEY ("subagentDefinitionId") REFERENCES "subagent_definitions"("id") ON DELETE CASCADE,
  CONSTRAINT "subagent_skills_skillId_fkey"
    FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "subagent_skills_subagentDefinitionId_skillId_key"
  ON "subagent_skills" ("subagentDefinitionId", "skillId");
