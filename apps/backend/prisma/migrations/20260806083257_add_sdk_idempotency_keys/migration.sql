-- Idempotency records for the public SDK API (/api/v1).
--
-- Rows are written inside the same transaction as the mutator they guard, so a
-- retried write cannot duplicate rows or re-fire post-commit side effects.

CREATE TABLE IF NOT EXISTS "non_zero"."sdk_idempotency_keys" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_idempotency_keys_pkey" PRIMARY KEY ("id")
);

-- The claim is an INSERT ... ON CONFLICT against this constraint; scoping by
-- user and endpoint means the same key on a different route is a distinct record.
CREATE UNIQUE INDEX IF NOT EXISTS "sdk_idempotency_keys_user_endpoint_key"
    ON "non_zero"."sdk_idempotency_keys" ("userId", "endpoint", "key");

-- Supports the TTL sweep.
CREATE INDEX IF NOT EXISTS "sdk_idempotency_keys_expires_at_idx"
    ON "non_zero"."sdk_idempotency_keys" ("expires_at");

-- gen_random_uuid() is used by the claim statement.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
