-- AlterTable
ALTER TABLE "public"."conversation_participants" ADD COLUMN     "isSubscribed" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "participationType" DROP NOT NULL;
