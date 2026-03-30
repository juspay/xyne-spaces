-- CreateEnum
CREATE TYPE "public"."SavedConfigContextType" AS ENUM ('BOARD');

-- CreateEnum
CREATE TYPE "public"."SavedConfigVisibility" AS ENUM ('PRIVATE', 'PUBLIC');

-- CreateEnum
CREATE TYPE "public"."SavedConfigEntityName" AS ENUM ('TICKET', 'FORM_ENTITY_VALUE');

-- CreateTable
CREATE TABLE "public"."saved_user_configurations" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contextType" "public"."SavedConfigContextType" NOT NULL,
    "contextId" TEXT NOT NULL,
    "visibility" "public"."SavedConfigVisibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_user_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."saved_user_configuration_values" (
    "id" TEXT NOT NULL,
    "configId" TEXT NOT NULL,
    "entityName" "public"."SavedConfigEntityName" NOT NULL,
    "fieldName" TEXT NOT NULL,
    "fieldValue" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "saved_user_configuration_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "saved_user_configurations_contextType_contextId_idx" ON "public"."saved_user_configurations"("contextType", "contextId");

-- CreateIndex
CREATE INDEX "saved_user_configurations_userId_idx" ON "public"."saved_user_configurations"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "saved_user_configurations_userId_contextId_name_key" ON "public"."saved_user_configurations"("userId", "contextId", "name");

-- CreateIndex
CREATE INDEX "saved_user_configuration_values_configId_idx" ON "public"."saved_user_configuration_values"("configId");
