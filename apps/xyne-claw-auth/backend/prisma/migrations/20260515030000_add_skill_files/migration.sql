-- Sibling files attached to a Skill — materialized alongside SKILL.md
-- into the session workspace at session start, so pi's resource loader
-- sees the entire skill directory (scripts, examples, assets, etc.).
--
-- relativePath is enforced to be a normalized POSIX path with no leading
-- slash and no ".." segments at write time (in the upload handler).

CREATE TABLE "skill_files" (
  "id"           TEXT PRIMARY KEY,
  "skillId"      TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "content"      TEXT NOT NULL,
  "contentType"  TEXT,
  "sizeBytes"    INTEGER NOT NULL,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  CONSTRAINT "skill_files_skillId_fkey"
    FOREIGN KEY ("skillId") REFERENCES "skills"("id") ON DELETE CASCADE
);

CREATE UNIQUE INDEX "skill_files_skillId_relativePath_key"
  ON "skill_files" ("skillId", "relativePath");
