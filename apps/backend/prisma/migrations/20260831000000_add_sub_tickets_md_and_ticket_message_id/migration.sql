ALTER TABLE "public"."conversations" ADD COLUMN "sub_tickets_md" TEXT;

ALTER TABLE "public"."tickets" ADD COLUMN "messageId" TEXT;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "tickets_messageId_key"
ON "public"."tickets"("messageId");
