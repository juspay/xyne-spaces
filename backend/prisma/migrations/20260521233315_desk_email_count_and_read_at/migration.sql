-- AlterTable
ALTER TABLE "public"."tickets" ADD COLUMN     "emailCount" INTEGER;

-- AlterTable
ALTER TABLE "public"."email_reads" ADD COLUMN     "lastReadEmailAt" TIMESTAMP(3) NOT NULL DEFAULT '2026-05-23T12:27:28.228462Z';
