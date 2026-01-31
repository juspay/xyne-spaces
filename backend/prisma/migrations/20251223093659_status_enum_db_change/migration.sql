
ALTER TABLE "tickets" ADD COLUMN "status_new" "TicketStatus";

-- Update data based on the mapping
UPDATE "tickets" SET "status_new" = 'NEW' WHERE "status" IN ('NEW', 'TO_BE_PICKED_UP', 'BACKLOG');
UPDATE "tickets" SET "status_new" = 'IN_PROGRESS' WHERE "status" IN ('IN_PROGRESS', 'ON_HOLD_EXTERNAL', 'ON_HOLD_INTERNAL');
UPDATE "tickets" SET "status_new" = 'RESOLVED' WHERE "status" IN ('COMPLETED', 'RESOLVED');
UPDATE "tickets" SET "status_new" = 'REJECTED' WHERE "status" IN ('REJECTED', 'DROPPED');

-- Handle any NULL values by setting them to NEW
UPDATE "tickets" SET "status_new" = 'NEW' WHERE "status_new" IS NULL;

-- Create the new enum type
CREATE TYPE "TicketStatus_new" AS ENUM ('NEW', 'IN_PROGRESS', 'WAIT_FOR_APPROVAL', 'REJECTED', 'RESOLVED');

-- Drop the default constraint before changing the column type
ALTER TABLE "tickets" ALTER COLUMN "status" DROP DEFAULT;

-- Change the column type using the migrated data
ALTER TABLE "tickets" ALTER COLUMN "status" TYPE "TicketStatus_new" USING ("status_new"::text::"TicketStatus_new");

-- Drop the temporary column
ALTER TABLE "tickets" DROP COLUMN "status_new";

-- Rename enum types
ALTER TYPE "TicketStatus" RENAME TO "TicketStatus_old";
ALTER TYPE "TicketStatus_new" RENAME TO "TicketStatus";

-- Drop the old enum type
DROP TYPE "TicketStatus_old";

-- Set the default value
ALTER TABLE "tickets" ALTER COLUMN "status" SET DEFAULT 'NEW';
