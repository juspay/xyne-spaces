-- SDK OAuth tables for the public Spaces SDK.
--
-- The backend is both authorization server and resource server: it mints
-- RS256 JWTs and verifies them locally (no external auth dependency).

-- Refresh tokens: the only revocation point for SDK sessions.
CREATE TABLE IF NOT EXISTS "non_zero"."sdk_refresh_tokens" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "workspaceId"  TEXT NOT NULL,
    "clientId"     TEXT NOT NULL,
    "familyId"     TEXT NOT NULL,
    "tokenHash"    TEXT NOT NULL,
    "prefix"       TEXT NOT NULL,
    "scopes"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rotated_at"   TIMESTAMP(3),
    "revoked_at"   TIMESTAMP(3),
    "expires_at"   TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"   TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sdk_refresh_tokens_tokenHash_key"
    ON "non_zero"."sdk_refresh_tokens" ("tokenHash");

CREATE INDEX IF NOT EXISTS "sdk_refresh_tokens_userId_idx"
    ON "non_zero"."sdk_refresh_tokens" ("userId");

CREATE INDEX IF NOT EXISTS "sdk_refresh_tokens_familyId_idx"
    ON "non_zero"."sdk_refresh_tokens" ("familyId");

CREATE INDEX IF NOT EXISTS "sdk_refresh_tokens_expires_at_idx"
    ON "non_zero"."sdk_refresh_tokens" ("expires_at");

-- Authorization codes: short-lived, one-time codes exchanged for tokens.
CREATE TABLE IF NOT EXISTS "non_zero"."sdk_authorization_codes" (
    "id"           TEXT NOT NULL,
    "code_hash"    TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "workspaceId"  TEXT NOT NULL,
    "memberId"     TEXT NOT NULL,
    "clientId"     TEXT NOT NULL,
    "scopes"       TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "redirect_uri" TEXT,
    "used_at"      TIMESTAMP(3),
    "expires_at"   TIMESTAMP(3) NOT NULL,
    "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdk_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "sdk_authorization_codes_code_hash_key"
    ON "non_zero"."sdk_authorization_codes" ("code_hash");

CREATE INDEX IF NOT EXISTS "sdk_authorization_codes_expires_at_idx"
    ON "non_zero"."sdk_authorization_codes" ("expires_at");
