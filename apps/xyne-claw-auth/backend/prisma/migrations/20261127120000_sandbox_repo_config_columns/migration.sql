-- sandbox_repo_configs: "template", "repoUrl" and "auxRepos" become columns, copied from "config".
-- "config" keeps all three, so nothing that reads it changes.
-- "template" stays nullable in the database: the code requires it on every write, and a required column
-- would make saves from claw-auth pods still running the previous release fail during the rollout.
-- Rows written by such a pod get their columns filled at the next claw-auth start-up.
ALTER TABLE "sandbox_repo_configs"
  ADD COLUMN "template" TEXT,
  ADD COLUMN "repoUrl" TEXT,
  ADD COLUMN "auxRepos" JSONB;

-- Same rules as repoConfigColumns() in sandboxRepoConfigRepository.ts: an empty string is no value.
UPDATE "sandbox_repo_configs" SET
  "template" = CASE WHEN jsonb_typeof("config"->'template') = 'string' THEN NULLIF("config"->>'template', '') END,
  "repoUrl" = CASE WHEN jsonb_typeof("config"->'repoUrl') = 'string' THEN NULLIF("config"->>'repoUrl', '') END,
  "auxRepos" = CASE WHEN jsonb_typeof("config"->'auxRepos') = 'array' THEN "config"->'auxRepos' END;

CREATE INDEX "sandbox_repo_configs_template_idx" ON "sandbox_repo_configs"("template");
