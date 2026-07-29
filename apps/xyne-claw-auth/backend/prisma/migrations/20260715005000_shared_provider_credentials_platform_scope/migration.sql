-- Allow platform-wide shared provider credentials (orgId NULL): one Codex/
-- Claude account bindable by agents across orgs. Creation of NULL-org rows is
-- CLAW_ADMIN-gated in the routes; org rows keep owner semantics.
ALTER TABLE "shared_provider_credentials" ALTER COLUMN "orgId" DROP NOT NULL;
