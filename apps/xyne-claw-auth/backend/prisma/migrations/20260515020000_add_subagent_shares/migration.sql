-- Per-subagent share grants: owner + N contributors can edit a custom
-- subagent. Mirrors agent_shares. Reads are not gated by this table —
-- all subagents are globally visible to authenticated users; shares only
-- decide who can edit/delete.

CREATE TABLE "subagent_shares" (
  "id"                    TEXT PRIMARY KEY,
  "subagentDefinitionId"  TEXT NOT NULL,
  "userId"                TEXT NOT NULL,
  "role"                  TEXT NOT NULL DEFAULT 'EDITOR',
  "sharedBy"              TEXT,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "subagent_shares_subagentDefinitionId_fkey"
    FOREIGN KEY ("subagentDefinitionId") REFERENCES "subagent_definitions"("id") ON DELETE CASCADE,
  CONSTRAINT "subagent_shares_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "subagent_shares_subagentDefinitionId_userId_key"
  ON "subagent_shares" ("subagentDefinitionId", "userId");
