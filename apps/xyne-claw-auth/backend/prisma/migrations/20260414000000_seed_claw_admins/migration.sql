-- Seed CLAW_ADMIN roles
INSERT INTO "user_roles" ("id", "userId", "role", "grantedBy", "createdAt")
SELECT gen_random_uuid()::text, u.id, 'CLAW_ADMIN', 'migration', NOW()
FROM "users" u
WHERE u.email IN ('john.doe@gmail.com')
ON CONFLICT ("userId", "role") DO NOTHING;
