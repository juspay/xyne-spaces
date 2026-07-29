-- CreateEnum
CREATE TYPE "public"."LinkVisibility" AS ENUM ('DEFAULT', 'PERSONAL');

-- CreateTable
CREATE TABLE "public"."links" (
    "id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "favicon" TEXT,
    "channelId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "visibility" "public"."LinkVisibility" NOT NULL DEFAULT 'DEFAULT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."link_access" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "link_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "links_channelId_visibility_idx" ON "public"."links"("channelId", "visibility");

-- CreateIndex
CREATE INDEX "links_channelId_createdBy_idx" ON "public"."links"("channelId", "createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "links_createdBy_url_channelId_key" ON "public"."links"("createdBy", "url", "channelId");

-- CreateIndex
CREATE INDEX "link_access_userId_idx" ON "public"."link_access"("userId");

-- CreateIndex
CREATE INDEX "link_access_linkId_idx" ON "public"."link_access"("linkId");

-- CreateIndex
CREATE UNIQUE INDEX "link_access_linkId_userId_key" ON "public"."link_access"("linkId", "userId");
