-- Personal provider credentials can bind to a shared org credential (same
-- semantics as agent bindings). Needed for the "connect once personally,
-- share to agents" flow: the personal row becomes a binding instead of
-- keeping a sibling token copy that would cross-invalidate the shared one.

ALTER TABLE "user_provider_credentials" ADD COLUMN "sharedCredentialId" TEXT;

CREATE INDEX "user_provider_credentials_sharedCredentialId_idx"
  ON "user_provider_credentials"("sharedCredentialId");

ALTER TABLE "user_provider_credentials"
  ADD CONSTRAINT "user_provider_credentials_sharedCredentialId_fkey"
  FOREIGN KEY ("sharedCredentialId") REFERENCES "shared_provider_credentials"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
