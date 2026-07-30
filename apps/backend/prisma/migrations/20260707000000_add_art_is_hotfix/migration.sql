-- Nullable, no DB default: Zero's optimistic client inserts don't run Postgres
-- defaults, so isHotfix is written app-side; NULL reads as "not a hotfix".
ALTER TABLE "public"."application_release_tickets" ADD COLUMN "isHotfix" BOOLEAN;

COMMENT ON COLUMN "public"."application_release_tickets"."isHotfix" IS 'Dev ticket entered THIS release as a hotfix (merged after the release head). NULL = not a hotfix.';
