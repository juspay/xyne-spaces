CREATE TABLE "design_artifact_shares" (
  "id"              TEXT NOT NULL,
  "tokenHash"       TEXT NOT NULL,
  "tokenCiphertext" TEXT NOT NULL,
  "tokenIv"         TEXT NOT NULL,
  "tokenAuthTag"    TEXT NOT NULL,
  "ownerUserId"     TEXT NOT NULL,
  "orgId"           TEXT NOT NULL,
  "conversationId"  TEXT NOT NULL,
  "attachmentId"    TEXT NOT NULL,
  "title"           TEXT NOT NULL,
  "expiresAt"       TIMESTAMP(3),
  "revokedAt"       TIMESTAMP(3),
  "viewCount"       INTEGER NOT NULL DEFAULT 0,
  "lastViewedAt"    TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  CONSTRAINT "design_artifact_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "design_artifact_shares_tokenHash_key"
  ON "design_artifact_shares"("tokenHash");
CREATE UNIQUE INDEX "design_artifact_shares_ownerUserId_conversationId_key"
  ON "design_artifact_shares"("ownerUserId", "conversationId");
CREATE INDEX "design_artifact_shares_orgId_updatedAt_idx"
  ON "design_artifact_shares"("orgId", "updatedAt");
CREATE INDEX "design_artifact_shares_attachmentId_idx"
  ON "design_artifact_shares"("attachmentId");

ALTER TABLE "design_artifact_shares"
  ADD CONSTRAINT "design_artifact_shares_attachmentId_fkey"
  FOREIGN KEY ("attachmentId") REFERENCES "chat_attachments"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
