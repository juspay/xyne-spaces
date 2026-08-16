-- Existing SDLC boards and their tickets intentionally remain ordinary project data.
DROP INDEX IF EXISTS "public"."projects_sdlcBoardId_key";

ALTER TABLE "public"."projects"
DROP COLUMN IF EXISTS "sdlcBoardId";
