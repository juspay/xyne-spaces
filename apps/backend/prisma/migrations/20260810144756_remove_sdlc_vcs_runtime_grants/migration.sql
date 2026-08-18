-- AlterTable
ALTER TABLE "public"."repos" DROP COLUMN "accessCheckStartedAt",
DROP COLUMN "accessCheckStatus",
DROP COLUMN "accessCheckedAt",
DROP COLUMN "accessCredentialRevision",
DROP COLUMN "accessErrorCode",
DROP COLUMN "accessErrorMessage",
DROP COLUMN "accessEvidence";

-- DropTable
DROP TABLE "workflow"."sdlc_vcs_runtime_grants";
