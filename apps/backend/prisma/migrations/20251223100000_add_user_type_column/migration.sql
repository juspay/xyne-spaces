-- CreateEnum
CREATE TYPE "UserType" AS ENUM ('USER', 'BOT');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "userType" "UserType" NOT NULL DEFAULT 'USER';
