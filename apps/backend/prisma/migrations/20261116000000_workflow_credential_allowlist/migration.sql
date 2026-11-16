-- AlterTable
ALTER TABLE "workflow"."workflow_credentials"
  ADD COLUMN "ownerId" TEXT,
  ADD COLUMN "allowedWorkflowIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Backfill: until now every workflow in a workspace could use every credential
-- by name. Keep the workflows that already reference a credential working by
-- allowing exactly those, and nothing else. The match is a JSON key containing
-- "credential" whose value is the credential's name (the HTTP step's
-- credentialName, trigger credential slots, ...), within the same workspace and
-- only among workflows v2 rows ("Workflow" type; the table holds other tenants).
-- ownerId stays NULL: the table never recorded who created a credential, so
-- those rows are managed by admins until re-created by a member.
UPDATE "workflow"."workflow_credentials" AS c
SET "allowedWorkflowIds" = COALESCE(
  (
    SELECT array_agg(w."id")
    FROM "public"."workflows" AS w
    WHERE w."workspaceId" = c."workspaceId"
      AND w."workflowType" = 'Workflow'
      AND w."context" ~ (
        '"[A-Za-z_]*[Cc]redential[A-Za-z_]*"\s*:\s*"'
        || regexp_replace(c."name", '([\\.^$*+?()\[\]{}|])', '\\\1', 'g')
        || '"'
      )
  ),
  ARRAY[]::TEXT[]
);
