-- CreateEnum
CREATE TYPE "public"."AppPermissionType" AS ENUM ('READ', 'WRITE');

-- CreateEnum
CREATE TYPE "public"."AppPermissionStatus" AS ENUM ('UNAPPROVED', 'APPROVED', 'PENDINGDELETE');

-- CreateTable
CREATE TABLE "public"."available_app_permissions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "public"."AppPermissionType" NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "available_app_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."app_permission" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."installed_app_permissions" (
    "id" TEXT NOT NULL,
    "installedAppId" TEXT NOT NULL,
    "permissionId" TEXT NOT NULL,
    "status" "public"."AppPermissionStatus" NOT NULL DEFAULT 'UNAPPROVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "installed_app_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "available_app_permissions_name_idx" ON "public"."available_app_permissions"("name");

-- CreateIndex
CREATE INDEX "available_app_permissions_type_idx" ON "public"."available_app_permissions"("type");

-- CreateIndex
CREATE UNIQUE INDEX "available_app_permissions_name_type_key" ON "public"."available_app_permissions"("name", "type");

-- CreateIndex
CREATE INDEX "app_permission_appId_idx" ON "public"."app_permission"("appId");

-- CreateIndex
CREATE INDEX "app_permission_permissionId_idx" ON "public"."app_permission"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "app_permission_appId_permissionId_key" ON "public"."app_permission"("appId", "permissionId");

-- CreateIndex
CREATE INDEX "installed_app_permissions_installedAppId_idx" ON "public"."installed_app_permissions"("installedAppId");

-- CreateIndex
CREATE INDEX "installed_app_permissions_permissionId_idx" ON "public"."installed_app_permissions"("permissionId");

-- CreateIndex
CREATE UNIQUE INDEX "installed_app_permissions_installedAppId_permissionId_key" ON "public"."installed_app_permissions"("installedAppId", "permissionId");
