-- CreateEnum
CREATE TYPE "public"."ChannelAddUserPolicy" AS ENUM ('EVERYONE', 'ADMINS_ONLY');

-- AlterTable
ALTER TABLE "public"."channels" ADD COLUMN "addUserPolicy" "public"."ChannelAddUserPolicy" DEFAULT 'EVERYONE';