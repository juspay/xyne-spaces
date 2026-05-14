-- CreateTable
CREATE TABLE "public"."app_commands" (
    "id" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "commandName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "isForThread" BOOLEAN NOT NULL DEFAULT true,
    "isForChat" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_commands_appId_idx" ON "public"."app_commands"("appId");

-- CreateIndex
CREATE UNIQUE INDEX "app_commands_appId_commandName_key" ON "public"."app_commands"("appId", "commandName");
