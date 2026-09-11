-- AlterTable
ALTER TABLE "public"."messages" ADD COLUMN     "sourceLang" TEXT;

-- AlterTable
ALTER TABLE "public"."user_preferences" ADD COLUMN     "preferredLanguage" TEXT NOT NULL DEFAULT 'en';

-- CreateTable
CREATE TABLE "public"."message_translations" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "targetLang" TEXT NOT NULL,
    "translatedText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_translations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "message_translations_messageId_idx" ON "public"."message_translations"("messageId");

-- CreateIndex
CREATE INDEX "message_translations_workspaceId_idx" ON "public"."message_translations"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "message_translations_messageId_targetLang_key" ON "public"."message_translations"("messageId", "targetLang");
