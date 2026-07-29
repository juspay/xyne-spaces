-- CreateEnum
CREATE TYPE "UserResponsibility" AS ENUM ('MANAGER', 'TEAM_LEAD', 'MEMBER');

-- AlterTable
ALTER TABLE "user_group_mappings" ADD COLUMN     "responsibility" "UserResponsibility" NOT NULL DEFAULT 'MEMBER';