-- AlterTable
ALTER TABLE "public"."board_complexity_scores" ADD COLUMN     "percentageShareBasis" TEXT NOT NULL DEFAULT 'ALL',
ADD COLUMN     "percentageWindowDays" INTEGER NOT NULL DEFAULT 7;
