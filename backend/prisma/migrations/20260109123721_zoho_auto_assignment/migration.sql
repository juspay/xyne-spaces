-- AlterTable
ALTER TABLE "board_complexity_scores" ADD COLUMN     "usePercentage" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "user_expertise_mappings" ADD COLUMN     "hasExpertise" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "maxTickets" INTEGER NOT NULL DEFAULT -1,
ADD COLUMN     "percentage" DOUBLE PRECISION NOT NULL DEFAULT 100.0;
