-- Backfill email on existing questionnaire_responses rows that have email = NULL.
-- Joins to users to get the email, picks one survivor per (email, questionnaireType)
-- group (most recently updated), and skips any group that already has an email
-- set (so the unique (email, questionnaireType) index is never violated).
WITH candidates AS (
  SELECT qr."id", lower(trim(u."email")) AS email, qr."questionnaireType", qr."updatedAt"
  FROM "non_zero"."questionnaire_responses" qr
  JOIN "non_zero"."users" u ON u."id" = qr."userId"
  WHERE qr."email" IS NULL AND u."email" IS NOT NULL
),
already_set AS (
  SELECT DISTINCT lower(trim("email")) AS email, "questionnaireType"
  FROM "non_zero"."questionnaire_responses" WHERE "email" IS NOT NULL
),
ranked AS (
  SELECT c."id", c.email, c."questionnaireType",
         ROW_NUMBER() OVER (
           PARTITION BY c.email, c."questionnaireType"
           ORDER BY c."updatedAt" DESC NULLS LAST, c."id" DESC
         ) AS rn
  FROM candidates c
  WHERE NOT EXISTS (SELECT 1 FROM already_set a
                    WHERE a.email = c.email AND a."questionnaireType" = c."questionnaireType")
)
UPDATE "non_zero"."questionnaire_responses" qr
SET "email" = r.email
FROM ranked r
WHERE qr."id" = r."id" AND r.rn = 1;
