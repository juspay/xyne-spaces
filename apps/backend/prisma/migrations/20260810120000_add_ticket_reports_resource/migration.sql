INSERT INTO "public"."resources" ("id", "name", "description", "createdAt", "updatedAt")
SELECT
  'ticket-reports-resource',
  'TICKET-REPORTS',
  'Ticket report export endpoints (/api/ticket-reports/*)',
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1
  FROM "public"."resources"
  WHERE "name" = 'TICKET-REPORTS'
);
