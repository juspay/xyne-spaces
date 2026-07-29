-- AlterEnum
ALTER TYPE "public"."AuthProvider" ADD VALUE 'EMAIL';

-- AlterTable
ALTER TABLE "public"."org_members" ADD COLUMN     "passwordHash" TEXT;