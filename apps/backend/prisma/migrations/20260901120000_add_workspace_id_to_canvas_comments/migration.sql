ALTER TABLE "public"."canvas_comment_threads"
ADD COLUMN "workspaceId" TEXT;


ALTER TABLE "public"."canvas_comments"
ADD COLUMN "workspaceId" TEXT;

