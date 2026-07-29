-- Phase 5 Slice A: register Slack in the surface catalog.
INSERT INTO "surfaces" (
  "id",
  "key",
  "identityMode",
  "supportsUserResolution",
  "status",
  "createdAt",
  "updatedAt"
)
VALUES (
  'slack',
  'slack',
  'USER_ID',
  true,
  'ACTIVE',
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
)
ON CONFLICT ("key") DO UPDATE SET
  "identityMode" = EXCLUDED."identityMode",
  "supportsUserResolution" = EXCLUDED."supportsUserResolution",
  "status" = EXCLUDED."status",
  "updatedAt" = CURRENT_TIMESTAMP;
