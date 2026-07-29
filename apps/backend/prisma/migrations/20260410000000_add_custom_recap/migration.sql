-- Add id column as primary key to channel_daily_recaps
ALTER TABLE "public"."channel_daily_recaps" ADD COLUMN "id" TEXT NOT NULL DEFAULT gen_random_uuid()::text;

-- Drop existing primary key and use id as the new primary key
ALTER TABLE "public"."channel_daily_recaps" DROP CONSTRAINT "channel_daily_recaps_pkey";
ALTER TABLE "public"."channel_daily_recaps" ADD CONSTRAINT "channel_daily_recaps_pkey" PRIMARY KEY ("id");

-- Add userId column (optional) for custom recap support
ALTER TABLE "public"."channel_daily_recaps" ADD COLUMN "userId" TEXT;

-- Add index on userId for efficient custom recap lookup
CREATE INDEX "channel_daily_recaps_userId_idx" ON "public"."channel_daily_recaps"("userId");

-- Add customRecapPrompt to channel_user_status for personalized recap prompts
ALTER TABLE "public"."channel_user_status" ADD COLUMN "customRecapPrompt" TEXT;
