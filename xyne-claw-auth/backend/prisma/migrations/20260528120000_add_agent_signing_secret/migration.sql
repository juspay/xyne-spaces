-- Add signingSecret column to agents — used to verify the HMAC-SHA256 that
-- Spaces puts in `X-Xyne-Signature` on every outbound webhook call. Stored
-- encrypted at rest with claw-auth's AES-256-GCM format (ciphertext:iv:authTag,
-- all base64).
--
-- Path: for NEW agents, the secret is fetched at configure-webhook time via
-- Spaces' POST /api/apps/signing-secret/:appId (returns plaintext, no
-- cross-service key parity needed).
-- For OLD agents (created before this column existed), an admin hits the
-- temporary endpoint POST /admin/backfill-signing-secrets which iterates
-- and fetches via the same API path using the admin's session token.
-- That route + file get deleted once backfill is complete.
--
-- Nullable on purpose: until the backfill completes, existing rows have no
-- secret, and the verify middleware runs in warn-only mode for those (logged
-- but not enforced). Once backfill is done, the env flag
-- SPACES_WEBHOOK_VERIFY_MODE=enforce flips the gate to fail-closed.

ALTER TABLE "agents"
    ADD COLUMN IF NOT EXISTS "signingSecret" TEXT;
