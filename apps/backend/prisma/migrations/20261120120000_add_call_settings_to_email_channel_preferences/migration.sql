-- AlterTable — per-desk call connection settings for CALL and APP desks. Not in the Zero client schema.
ALTER TABLE "public"."email_channel_preferences" ADD COLUMN     "callConnectionId" TEXT,
ADD COLUMN     "callIsDefault" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "callSettings" JSONB;

-- CreateIndex
CREATE INDEX "email_channel_preferences_callConnectionId_idx" ON "public"."email_channel_preferences"("callConnectionId");

-- At most one default call desk per connection. Prisma cannot express a partial unique index, so it is created by hand.
CREATE UNIQUE INDEX "email_channel_preferences_one_default_call_desk" ON "public"."email_channel_preferences"("callConnectionId") WHERE "callIsDefault";
