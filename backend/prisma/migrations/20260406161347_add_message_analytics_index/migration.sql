-- CreateIndex
CREATE INDEX "messages_msgType_createdAt_idx" ON "public"."messages"("msgType", "createdAt");
