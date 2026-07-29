-- AlterTable
ALTER TABLE "public"."channels" ADD COLUMN     "isArchived" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "channels_isArchived_idx" ON "public"."channels"("isArchived");
