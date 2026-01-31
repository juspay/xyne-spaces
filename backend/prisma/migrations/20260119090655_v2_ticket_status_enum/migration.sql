-- CreateEnum
CREATE TYPE "TicketStatusV2" AS ENUM ('TODO', 'STARTED', 'PAUSED', 'CANCELLED', 'COMPLETED');

-- AlterTable
ALTER TABLE "stages" ADD COLUMN     "defaultTicketStatusV2" "TicketStatusV2" NOT NULL DEFAULT 'STARTED';

-- AlterTable
ALTER TABLE "tickets" ADD COLUMN     "statusV2" "TicketStatusV2" NOT NULL DEFAULT 'TODO';
