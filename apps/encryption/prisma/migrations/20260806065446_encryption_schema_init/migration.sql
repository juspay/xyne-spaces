-- CreateTable
CREATE TABLE "user_session_keys" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wrappedKey" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_session_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_encryption_configs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "masterKeyRef" TEXT NOT NULL,
    "useCustomerManagedKey" BOOLEAN NOT NULL DEFAULT false,
    "providerConfig" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_encryption_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "org_data_encryption_keys" (
    "dekId" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "wrappedDek" BYTEA NOT NULL,
    "status" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "org_data_encryption_keys_pkey" PRIMARY KEY ("dekId")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_session_keys_sessionId_key" ON "user_session_keys"("sessionId");

-- CreateIndex
CREATE INDEX "org_encryption_configs_orgId_idx" ON "org_encryption_configs"("orgId");

-- CreateIndex
CREATE INDEX "org_data_encryption_keys_configId_idx" ON "org_data_encryption_keys"("configId");

-- CreateIndex
CREATE INDEX "org_data_encryption_keys_entityType_entityId_status_idx" ON "org_data_encryption_keys"("entityType", "entityId", "status");

-- AddForeignKey
ALTER TABLE "org_data_encryption_keys" ADD CONSTRAINT "org_data_encryption_keys_configId_fkey" FOREIGN KEY ("configId") REFERENCES "org_encryption_configs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Enforce one active data-encryption key per entity.
CREATE UNIQUE INDEX "org_data_encryption_keys_one_active_per_entity_idx"
  ON "org_data_encryption_keys"("entityType", "entityId")
  WHERE "status" = 'ACTIVE';