

-- AlterTable
ALTER TABLE "public"."apps" ADD COLUMN     "orgId" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "scope" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "signingSecret" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "webhookUrl" TEXT;

-- AlterTable
ALTER TABLE "public"."installed_apps" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "signingSecret" DROP NOT NULL;

-- CreateTable
CREATE TABLE "public"."installed_app_commands" (
    "id" TEXT NOT NULL,
    "installedAppId" TEXT NOT NULL,
    "sourceCommandId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "commandType" "public"."CommandType" NOT NULL,
    "commandAccessibility" "public"."CommandAccessibility" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "installed_app_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "installed_app_commands_installedAppId_idx" ON "public"."installed_app_commands"("installedAppId");

-- CreateIndex
CREATE INDEX "apps_orgId_idx" ON "public"."apps"("orgId");

-- CreateIndex
CREATE INDEX "apps_scope_idx" ON "public"."apps"("scope");
