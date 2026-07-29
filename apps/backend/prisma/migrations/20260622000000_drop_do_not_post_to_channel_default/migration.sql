-- doNotPostToChannel is handled in code (NULL = not hidden), so the large conversations
-- table doesn't carry a DB-level default. Drop the DEFAULT added in 20260621000000.
ALTER TABLE "public"."conversations" ALTER COLUMN "doNotPostToChannel" DROP DEFAULT;
