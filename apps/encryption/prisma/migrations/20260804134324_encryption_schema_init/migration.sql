-- CreateTable
CREATE TABLE "encryption"."user_session_keys" (
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "wrappedKey" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_session_keys_pkey" PRIMARY KEY ("sessionId")
);

-- CreateTable
CREATE TABLE "encryption"."org_encryption_configs" (
    "orgId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "kmsKeyRef" TEXT NOT NULL,
    "useCustomerManagedKey" BOOLEAN NOT NULL DEFAULT false,
    "providerConfig" JSONB,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "org_encryption_configs_pkey" PRIMARY KEY ("orgId")
);

-- CreateTable
CREATE TABLE "encryption"."org_data_encryption_keys" (
    "dekId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "wrappedDek" BYTEA NOT NULL,
    "wrappingProvider" TEXT NOT NULL,
    "wrappingKeyRef" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "activatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rotatedAt" TIMESTAMP(3),
    "deactivatedAt" TIMESTAMP(3),

    CONSTRAINT "org_data_encryption_keys_pkey" PRIMARY KEY ("dekId")
);

-- CreateIndex
CREATE INDEX "user_session_keys_userId_idx" ON "encryption"."user_session_keys"("userId");

-- CreateIndex
CREATE INDEX "user_session_keys_expiresAt_idx" ON "encryption"."user_session_keys"("expiresAt");

-- CreateIndex
CREATE INDEX "org_data_encryption_keys_workspaceId_status_activatedAt_idx" ON "encryption"."org_data_encryption_keys"("workspaceId", "status", "activatedAt" DESC);

-- Enforce one active data-encryption key per workspace.
CREATE UNIQUE INDEX "org_data_encryption_keys_one_active_per_workspace_idx"
  ON "encryption"."org_data_encryption_keys"("workspaceId")
  WHERE "status" = 'ACTIVE';
