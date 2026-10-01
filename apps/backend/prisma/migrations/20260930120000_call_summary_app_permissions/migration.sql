INSERT INTO "public"."available_app_permissions"
("id", "name", "type", "description", "createdAt")
VALUES
  (gen_random_uuid()::text, 'calls',     'READ',  'Read call details, participants and transcripts', NOW()),
  (gen_random_uuid()::text, 'summaries', 'READ',  'Read call summaries and summary templates',       NOW()),
  (gen_random_uuid()::text, 'summaries', 'WRITE', 'Regenerate call summaries',                       NOW())
ON CONFLICT ("name", "type") DO NOTHING;
