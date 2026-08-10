-- Skill versioning + per-agent version pins.
--
-- Adds an immutable, append-only `skill_versions` table (mirrors
-- agent_prompt_versions) and a nullable `pinnedVersionId` on the agent/subagent
-- skill junctions so each agent runs a specific version. Backfills every
-- existing skill as version 1 and pins every existing junction row to it, so
-- the change is behaviour-neutral on deploy (nothing "floats" and the runtime
-- resolves the same content it does today).

-- pgcrypto gives us digest() for the backfill content hash (matches the app's
-- SHA-256 over normalized content closely enough for the advisory version hash)
-- and gen_random_uuid() for generated ids.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1) Immutable version snapshots.
CREATE TABLE "skill_versions" (
  "id"            TEXT NOT NULL,
  "skillId"       TEXT NOT NULL,
  "version"       INTEGER NOT NULL,
  "content"       TEXT NOT NULL,
  "contentHash"   TEXT NOT NULL,
  "filesSnapshot" JSONB NOT NULL DEFAULT '[]',
  "authorUserId"  TEXT,
  "source"        TEXT NOT NULL,
  "changelog"     TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "skill_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "skill_versions_skillId_version_key" ON "skill_versions" ("skillId", "version");
CREATE INDEX "skill_versions_skillId_idx" ON "skill_versions" ("skillId");

ALTER TABLE "skill_versions"
  ADD CONSTRAINT "skill_versions_skillId_fkey"
  FOREIGN KEY ("skillId") REFERENCES "skills" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Pointers / pins.
ALTER TABLE "skills"          ADD COLUMN "currentVersionId" TEXT;
ALTER TABLE "agent_skills"    ADD COLUMN "pinnedVersionId"  TEXT;
ALTER TABLE "subagent_skills" ADD COLUMN "pinnedVersionId"  TEXT;

CREATE INDEX "agent_skills_pinnedVersionId_idx"    ON "agent_skills" ("pinnedVersionId");
CREATE INDEX "subagent_skills_pinnedVersionId_idx" ON "subagent_skills" ("pinnedVersionId");

ALTER TABLE "agent_skills"
  ADD CONSTRAINT "agent_skills_pinnedVersionId_fkey"
  FOREIGN KEY ("pinnedVersionId") REFERENCES "skill_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "subagent_skills"
  ADD CONSTRAINT "subagent_skills_pinnedVersionId_fkey"
  FOREIGN KEY ("pinnedVersionId") REFERENCES "skill_versions" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 3) Backfill: one v1 per existing skill, snapshotting its current files.
--    contentHash is computed over a SQL approximation of normalizeSkillContent
--    (CRLF->LF, strip per-line trailing whitespace, trim). It is advisory only.
INSERT INTO "skill_versions" ("id", "skillId", "version", "content", "contentHash", "filesSnapshot", "authorUserId", "source", "createdAt")
SELECT
  'skv_' || replace(gen_random_uuid()::text, '-', ''),
  s."id",
  1,
  s."content",
  encode(
    digest(
      btrim(
        regexp_replace(
          regexp_replace(
            replace(replace(s."content", E'\r\n', E'\n'), E'\r', E'\n'),
          '[ \t]+\n', E'\n', 'g'),
        '[ \t]+$', '', 'g'),
        E' \t\n\r'
      ),
      'sha256'
    ),
    'hex'
  ),
  COALESCE(
    (SELECT jsonb_agg(
        jsonb_build_object(
          'relativePath', f."relativePath",
          'content',      f."content",
          'contentType',  f."contentType",
          'sizeBytes',    f."sizeBytes"
        ) ORDER BY f."relativePath"
     )
     FROM "skill_files" f WHERE f."skillId" = s."id"),
    '[]'::jsonb
  ),
  s."ownerUserId",
  'initial',
  now()
FROM "skills" s;

-- 4) Point each skill at its v1, and pin every existing junction row to v1.
UPDATE "skills" s
  SET "currentVersionId" = v."id"
  FROM "skill_versions" v
  WHERE v."skillId" = s."id" AND v."version" = 1;

UPDATE "agent_skills" a
  SET "pinnedVersionId" = v."id"
  FROM "skill_versions" v
  WHERE v."skillId" = a."skillId" AND v."version" = 1;

UPDATE "subagent_skills" a
  SET "pinnedVersionId" = v."id"
  FROM "skill_versions" v
  WHERE v."skillId" = a."skillId" AND v."version" = 1;

-- 5) Per-agent version-adoption request columns (requestType="skill_version_adopt").
ALTER TABLE "agent_requests" ADD COLUMN "toVersionId"   TEXT;
ALTER TABLE "agent_requests" ADD COLUMN "fromVersionId" TEXT;

-- 6) Audit events for skill-version propagation (Point 3/4).
-- ADD VALUE is committed here; the values are only *used* at runtime by app
-- code, so same-transaction use is never attempted.
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'SKILL_VERSION_AUTO_ADOPTED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'SKILL_VERSION_ADOPT_REQUESTED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'SKILL_VERSION_ADOPTED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'SKILL_VERSION_ADOPT_DECLINED';
