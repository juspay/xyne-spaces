-- Require PKCE for public SDK OAuth clients. The verifier remains client-side;
-- only its S256 challenge is stored with the one-time authorization code.
ALTER TABLE "non_zero"."sdk_authorization_codes"
  ADD COLUMN IF NOT EXISTS "code_challenge" TEXT,
  ADD COLUMN IF NOT EXISTS "code_challenge_method" TEXT NOT NULL DEFAULT 'S256';

-- Existing unconsumed codes predate PKCE and must not remain exchangeable.
DELETE FROM "non_zero"."sdk_authorization_codes"
WHERE "code_challenge" IS NULL;

ALTER TABLE "non_zero"."sdk_authorization_codes"
  ALTER COLUMN "code_challenge" SET NOT NULL;
