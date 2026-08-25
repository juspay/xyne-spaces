-- Make projectId nullable on surface_nudges and surface_links

ALTER TABLE "public"."surface_nudges" ALTER COLUMN "projectId" DROP NOT NULL;
ALTER TABLE "public"."surface_links" ALTER COLUMN "projectId" DROP NOT NULL;

-- Drop projectId indexes (no longer used for queries)
DROP INDEX IF EXISTS "public"."surface_nudges_projectId_state_idx";
DROP INDEX IF EXISTS "public"."surface_links_projectId_idx";

-- Make projectId nullable on conversation_labels

ALTER TABLE "public"."conversation_labels" ALTER COLUMN "projectId" DROP NOT NULL;

