-- AlterTable
ALTER TABLE "public"."board_complexity_scores" ADD COLUMN     "percentageShareBasis" TEXT,
ADD COLUMN     "percentageWindowDays" INTEGER,
ADD COLUMN     "percentageWindowStartAt" TIMESTAMP(3);
