-- Infrastructure tables for the public Spaces SDK API and its OAuth 2.0
-- authorization-code flow with mandatory S256 PKCE.

-- The SDK mutation engine generates idempotency row ids with gen_random_uuid().
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Idempotency records are claimed in the same transaction as their mutation.
CREATE TABLE "non_zero"."sdk_idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_idempotency_keys_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sdk_idempotency_keys_workspace_user_endpoint_key"
    ON "non_zero"."sdk_idempotency_keys" ("workspaceId", "userId", "endpoint", "key");

CREATE INDEX "sdk_idempotency_keys_workspaceId_idx"
    ON "non_zero"."sdk_idempotency_keys" ("workspaceId");

CREATE INDEX "sdk_idempotency_keys_expires_at_idx"
    ON "non_zero"."sdk_idempotency_keys" ("expires_at");

-- Refresh tokens are hashed at rest and rotate after every successful refresh.
CREATE TABLE "non_zero"."sdk_refresh_tokens" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "rotated_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_refresh_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sdk_refresh_tokens_tokenHash_key"
    ON "non_zero"."sdk_refresh_tokens" ("tokenHash");

CREATE INDEX "sdk_refresh_tokens_userId_idx"
    ON "non_zero"."sdk_refresh_tokens" ("userId");

CREATE INDEX "sdk_refresh_tokens_familyId_idx"
    ON "non_zero"."sdk_refresh_tokens" ("familyId");

CREATE INDEX "sdk_refresh_tokens_expires_at_idx"
    ON "non_zero"."sdk_refresh_tokens" ("expires_at");

-- Authorization codes are one-time, short-lived, and bound to an S256 PKCE
-- challenge before they can be exchanged for tokens.
CREATE TABLE "non_zero"."sdk_authorization_codes" (
    "id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scopes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "redirect_uri" TEXT,
    "code_challenge" TEXT NOT NULL,
    "code_challenge_method" TEXT NOT NULL DEFAULT 'S256',
    "used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sdk_authorization_codes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sdk_authorization_codes_code_hash_key"
    ON "non_zero"."sdk_authorization_codes" ("code_hash");

CREATE INDEX "sdk_authorization_codes_expires_at_idx"
    ON "non_zero"."sdk_authorization_codes" ("expires_at");
