-- Artifact apps a channel admin published to every member's tabs, as a JSON string[].
-- Nullable with no default: every existing row (desks included) stays NULL; desk
-- channels are never written (mutator + ACL reject them).
ALTER TABLE "public"."channels" ADD COLUMN "publishedAppIds" TEXT;
