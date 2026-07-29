-- Add emailReplyEnabled column to Ticket table
-- Default is true so existing tickets will have email replies enabled by default

ALTER TABLE "tickets" ADD COLUMN "emailReplyEnabled" BOOLEAN NOT NULL DEFAULT true;
