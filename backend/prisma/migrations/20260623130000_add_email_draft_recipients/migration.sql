-- Unified drafts: make email_drafts a single synced server record carrying body, recipients,
-- and compose-draft fields (so drafts stop being split across DB + localStorage).

-- Reply/compose recipients — TEXT holding a JSON-stringified string[] (no JSONB;
-- stringify/parse handled app-side). Moved off localStorage.
ALTER TABLE "public"."email_drafts" ADD COLUMN "toRecipients" TEXT;
ALTER TABLE "public"."email_drafts" ADD COLUMN "ccRecipients" TEXT;
ALTER TABLE "public"."email_drafts" ADD COLUMN "bccRecipients" TEXT;

-- Compose drafts have no thread yet, so conversationId must be nullable (NULLs are distinct in
-- the @@unique([userId, conversationId]) index → many compose drafts per user, one reply draft
-- per (user, thread)). subject + fromAddress hold the compose "Subject"/"From"; reply drafts
-- inherit these from the thread.
ALTER TABLE "public"."email_drafts" ALTER COLUMN "conversationId" DROP NOT NULL;
ALTER TABLE "public"."email_drafts" ADD COLUMN "subject" TEXT;
ALTER TABLE "public"."email_drafts" ADD COLUMN "fromAddress" TEXT;
