-- CreateTable
CREATE TABLE "common"."secret_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "rotationState" TEXT NOT NULL DEFAULT 'idle',
    "createdBy" TEXT NOT NULL,
    "updatedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "secret_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "common"."secret_versions" (
    "id" TEXT NOT NULL,
    "secretDefinitionId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "value" TEXT NOT NULL,
    "encryptionImpl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifiedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "secret_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "secret_definitions_name_key" ON "common"."secret_definitions"("name");

-- CreateIndex
CREATE INDEX "secret_versions_secretDefinitionId_status_idx" ON "common"."secret_versions"("secretDefinitionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "secret_versions_secretDefinitionId_version_key" ON "common"."secret_versions"("secretDefinitionId", "version");
