-- Add classificationData field to Ticket table
ALTER TABLE "public"."tickets" ADD COLUMN "classificationData" JSONB;
ALTER TABLE "public"."tickets" ADD COLUMN "aiCategory" TEXT;
ALTER TABLE "public"."tickets" ADD COLUMN "aiSubCategory" TEXT;

CREATE INDEX "tickets_aiCategory_aiSubCategory_idx" ON "public"."tickets"("aiCategory", "aiSubCategory");

-- Add classification config columns to email_channel_preferences
ALTER TABLE "public"."email_channel_preferences"
  ADD COLUMN "classificationEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "classificationPrompt" TEXT,
  ADD COLUMN "categoryField" TEXT,
  ADD COLUMN "subCategoryField" TEXT;

-- Create ClassificationMapping table (channelId-based, no separate config table)
CREATE TABLE "public"."classification_mappings" (
    "id" TEXT NOT NULL,
    "channelId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "subCategory" TEXT,
    "userGroupId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classification_mappings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "classification_mappings_channelId_idx" ON "public"."classification_mappings"("channelId");
CREATE INDEX "classification_mappings_channelId_category_idx" ON "public"."classification_mappings"("channelId", "category");
