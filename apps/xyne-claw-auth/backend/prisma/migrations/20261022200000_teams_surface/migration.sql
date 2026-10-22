-- Microsoft Teams as a messaging channel (XYNE-66904).
--
-- 'teams' an Azure Bot registration, one per org. Teams POSTs activities to
--         the account's webhook; 1:1 chats, group chats and channel threads.
--         The plugin is only registered when TEAMS_CHANNEL_ENABLED is on, so
--         this row alone exposes nothing.
INSERT INTO "surfaces" (
  "id", "key", "identityMode", "supportsUserResolution", "capabilities", "status", "createdAt", "updatedAt"
)
VALUES
  ('teams', 'teams', 'USER_ID', true,
   '{"transport":"webhook","login":"token","groups":true,"scope":"org"}'::jsonb,
   'ACTIVE', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO UPDATE SET
  "identityMode" = EXCLUDED."identityMode",
  "supportsUserResolution" = EXCLUDED."supportsUserResolution",
  "capabilities" = EXCLUDED."capabilities",
  "status" = EXCLUDED."status",
  "updatedAt" = CURRENT_TIMESTAMP;
