-- AlterTable
ALTER TABLE "workflow"."notifications" ALTER COLUMN "title" DROP NOT NULL,
ALTER COLUMN "message" DROP NOT NULL;
