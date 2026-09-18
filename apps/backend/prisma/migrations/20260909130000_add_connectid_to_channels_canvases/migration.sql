-- AlterTable
ALTER TABLE "public"."channels" ADD COLUMN "connectId" TEXT;

-- AlterTable
ALTER TABLE "public"."canvases" ADD COLUMN "connectId" TEXT;

-- CreateIndex
CREATE INDEX "channels_connectId_idx" ON "public"."channels"("connectId");

-- CreateIndex
CREATE INDEX "canvases_connectId_idx" ON "public"."canvases"("connectId");
