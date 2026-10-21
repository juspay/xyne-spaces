INSERT INTO "public"."available_app_permissions" ("id", "name", "type", "description", "createdAt")
VALUES
  (gen_random_uuid()::text, 'app_mentioned',                 'SUBSCRIBE', 'Receive an event when the app is @mentioned',                                   NOW()),
  (gen_random_uuid()::text, 'direct_message',                'SUBSCRIBE', 'Receive direct messages sent to the app',                                       NOW()),
  (gen_random_uuid()::text, 'user_mentioned',                'SUBSCRIBE', 'Receive an event when a user is mentioned in a channel the app is in',          NOW()),
  (gen_random_uuid()::text, 'email',                         'SUBSCRIBE', 'Receive inbound emails in channels the app is in',                              NOW()),
  (gen_random_uuid()::text, 'additional_form_field_updated', 'SUBSCRIBE', 'Receive an event when a ticket form field changes in a channel the app is in',   NOW()),
  (gen_random_uuid()::text, 'desk_reply',                    'SUBSCRIBE', 'Receive agent replies on App Desk tickets backed by the app',                   NOW()),
  (gen_random_uuid()::text, 'call_summary_ready',            'SUBSCRIBE', 'Receive the summary of a call the app scheduled',                               NOW())
ON CONFLICT ("name", "type") DO NOTHING;
