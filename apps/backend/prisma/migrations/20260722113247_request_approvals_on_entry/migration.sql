-- AlterTable
ALTER TABLE "public"."stage_transitions" ADD COLUMN     "requestApprovalOnEntry" BOOLEAN;

-- AlterTable
ALTER TABLE "public"."stages" ADD COLUMN     "requestApprovalOnEntry" BOOLEAN;
