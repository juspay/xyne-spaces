-- AlterTable
ALTER TABLE "non_zero"."scheduled_messages" ADD COLUMN     "dayOfMonth" INTEGER,
ADD COLUMN     "frequency" TEXT NOT NULL DEFAULT 'WEEKLY',
ADD COLUMN     "monthlyMode" TEXT,
ADD COLUMN     "weekOrdinal" TEXT,
ADD COLUMN     "weekday" INTEGER;

