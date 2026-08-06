-- Refresh tokens for the public Spaces SDK.
--
-- Access tokens are short-lived signed JWTs verified offline by the Spaces
-- resource server, so these rows are the only revocation point in the system.

CREATE TABLE IF NOT EXISTS "sdk_refresh_tokens" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "orgId"      TEXT NOT NULL,
    "clientId"   TEXT NOT NULL,
    "familyId"   TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "prefix"     TEXT NOT NULL,
    "scopes"     TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rotatedAt"  TIMESTAMP(3),
    "revokedAt"  TIMESTAMP(3),
    "expiresAt"  TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"  TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Lookup is always by hash; the raw token is never stored.
CREATE UNIQUE INDEX IF NOT EXISTS "sdk_refresh_tokens_tokenHash_key"
    ON "sdk_refresh_tokens" ("tokenHash");

CREATE INDEX IF NOT EXISTS "sdk_refresh_tokens_userId_idx"
    ON "sdk_refresh_tokens" ("userId");

-- Reuse detection revokes an entire family in one statement.
CREATE INDEX IF NOT EXISTS "sdk_refresh_tokens_familyId_idx"
    ON "sdk_refresh_tokens" ("familyId");

CREATE INDEX IF NOT EXISTS "sdk_refresh_tokens_expiresAt_idx"
    ON "sdk_refresh_tokens" ("expiresAt");

DO $$
BEGIN
    ALTER TABLE "sdk_refresh_tokens"
        ADD CONSTRAINT "sdk_refresh_tokens_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;
