
--renaming existing duplicate app names
WITH
  d AS (
  SELECT
    a.id,
    a.name,
    w.name AS ws_name,
    COUNT(*) OVER (PARTITION BY a."orgId", a.name) AS org_copies,
    COUNT(*) OVER (PARTITION BY a."orgId", a.name, a."workspaceId") AS ws_copies,
    ROW_NUMBER() OVER (PARTITION BY a."orgId", a.name, a."workspaceId" ORDER BY a."createdAt", a.id) AS seq
  FROM
    apps a
  JOIN
    workspaces w
    ON w.id = a."workspaceId")
UPDATE
  apps a
SET
  name = d.name || '-' || d.ws_name ||
  CASE
    WHEN d.ws_copies > 1 THEN '-' || d.seq
    ELSE '' END,
  "updatedAt" = now()
FROM
  d
WHERE
  a.id = d.id
  AND d.org_copies > 1;

-- CreateIndex
CREATE UNIQUE INDEX "apps_orgId_name_key" ON "public"."apps"("orgId", "name");
