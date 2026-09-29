-- CreateTable
CREATE TABLE "non_zero"."service_accounts" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."service_account_keys" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedBy" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "service_account_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "non_zero"."service_account_resources" (
    "workspaceId" TEXT NOT NULL,
    "serviceAccountId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "addedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_account_resources_pkey" PRIMARY KEY ("serviceAccountId","resourceType","resourceId")
);

-- CreateIndex
CREATE INDEX "service_accounts_workspaceId_idx" ON "non_zero"."service_accounts"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "service_account_keys_keyHash_key" ON "non_zero"."service_account_keys"("keyHash");

-- CreateIndex
CREATE INDEX "service_account_keys_serviceAccountId_idx" ON "non_zero"."service_account_keys"("serviceAccountId");

-- CreateIndex
CREATE INDEX "service_account_resources_resourceType_resourceId_idx" ON "non_zero"."service_account_resources"("resourceType", "resourceId");

