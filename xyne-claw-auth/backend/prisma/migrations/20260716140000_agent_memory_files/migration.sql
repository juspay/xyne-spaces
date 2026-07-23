-- Deterministic, file-based agent memory (Memory v2). Generic across agents,
-- scoped by (agentSlug, userId, name). The Digital Twin uses agentSlug
-- "digital-twin" with a per-user userId; userId NULL = shared across all users
-- of an agent. Named documents (e.g. soul.md) fetched by key, up to 3 flagged
-- loadInPrompt and injected verbatim into the agent's system prompt.
CREATE TABLE "agent_memory_files" (
  "id"           TEXT NOT NULL,
  "agentSlug"    TEXT NOT NULL,
  "userId"       TEXT,
  "name"         TEXT NOT NULL,
  "content"      TEXT NOT NULL DEFAULT '',
  "loadInPrompt" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "updatedBy"    TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "agent_memory_files_pkey" PRIMARY KEY ("id")
);

-- One file per (agent, user, name). NB: Postgres treats NULL userId rows as
-- distinct, so shared-agent (userId NULL) uniqueness is additionally enforced
-- in the app's upsert (findFirst + create/update).
CREATE UNIQUE INDEX "agent_memory_files_agentSlug_userId_name_key"
  ON "agent_memory_files" ("agentSlug", "userId", "name");

-- Fast "which files does this (agent,user) load into the prompt" lookup.
CREATE INDEX "agent_memory_files_agentSlug_userId_loadInPrompt_idx"
  ON "agent_memory_files" ("agentSlug", "userId", "loadInPrompt");

-- Cascade with the owning user (per-user files); shared (NULL) rows are untouched.
ALTER TABLE "agent_memory_files"
  ADD CONSTRAINT "agent_memory_files_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
