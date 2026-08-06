ALTER TABLE "public"."emails"
ADD COLUMN "rating" INTEGER,
ADD COLUMN "clientVersionName" TEXT,
ADD COLUMN "clientVersionCode" TEXT;

CREATE INDEX "emails_workspaceId_rating_idx"
ON "public"."emails"("workspaceId", "rating");

CREATE INDEX "emails_workspaceId_clientVersionName_idx"
ON "public"."emails"("workspaceId", "clientVersionName");
