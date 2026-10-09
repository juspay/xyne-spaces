CREATE TABLE "artifact_comments" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "artifactId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "anchor" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "byAgent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artifact_comments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "artifact_comments_artifactId_createdAt_idx" ON "artifact_comments"("artifactId", "createdAt");
CREATE INDEX "artifact_comments_conversationId_createdAt_idx" ON "artifact_comments"("conversationId", "createdAt");
