INSERT INTO "public"."available_app_permissions"
("id", "name", "type", "description", "createdAt")
VALUES
  (gen_random_uuid()::text, 'guests',   'READ',  'List the guest users this app created', NOW()),
  (gen_random_uuid()::text, 'guests',   'WRITE', 'Create, update and deactivate this app''s guest users and issue their SDK tokens', NOW()),
  (gen_random_uuid()::text, 'channels', 'WRITE', 'Create private channels with an internal owner and this app as a member', NOW())
ON CONFLICT ("name", "type") DO NOTHING;
