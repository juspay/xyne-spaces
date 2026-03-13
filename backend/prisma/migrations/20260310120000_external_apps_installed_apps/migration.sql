-- AlterEnum: add APP user type
ALTER TYPE "UserType" ADD VALUE IF NOT EXISTS 'APP';

-- CreateTable: apps
CREATE TABLE "public"."apps" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "apps_pkey" PRIMARY KEY ("id")
);

-- CreateTable: installed_apps
CREATE TABLE "public"."installed_apps" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "webhookUrl" TEXT,
    "signingSecret" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "installed_apps_pkey" PRIMARY KEY ("id")
);

-- Indexes for apps
CREATE INDEX "apps_name_idx" ON "public"."apps"("name");
CREATE INDEX "apps_createdBy_idx" ON "public"."apps"("createdBy");

-- Indexes for installed_apps
CREATE INDEX "installed_apps_appId_idx" ON "public"."installed_apps"("appId");
CREATE INDEX "installed_apps_userId_idx" ON "public"."installed_apps"("userId");
