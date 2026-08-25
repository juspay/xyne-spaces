-- CreateTable
CREATE TABLE "non_zero"."sdk_api_keys" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdk_api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sdk_api_keys_token_key" ON "non_zero"."sdk_api_keys"("token");

-- CreateIndex
CREATE INDEX "sdk_api_keys_workspaceId_idx" ON "non_zero"."sdk_api_keys"("workspaceId");

-- CreateIndex
CREATE INDEX "sdk_api_keys_userId_idx" ON "non_zero"."sdk_api_keys"("userId");

-- CreateIndex
CREATE INDEX "sdk_api_keys_expires_at_idx" ON "non_zero"."sdk_api_keys"("expires_at");

-- CreateIndex
CREATE INDEX "sdk_api_keys_status_idx" ON "non_zero"."sdk_api_keys"("status");
