
CREATE TABLE "public"."sdlc_folders" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sdlc_folders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sdlc_folders_workspaceId_idx" ON "public"."sdlc_folders"("workspaceId");
