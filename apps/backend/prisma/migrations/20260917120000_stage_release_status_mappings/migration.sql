-- Stage <-> release-status mapping (mirrors stage_pr_status_mappings): when the
-- release carrying a dev ticket transitions to "releaseStatus", the dev ticket
-- moves to the mapped stage.
CREATE TABLE "public"."stage_release_status_mappings" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "stageId" TEXT NOT NULL,
    "releaseStatus" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stage_release_status_mappings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "stage_release_status_mappings_stageId_releaseStatus_key" ON "public"."stage_release_status_mappings"("stageId", "releaseStatus");
