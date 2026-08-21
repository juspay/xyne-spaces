-- Canvas kind: DEFAULT for normal canvases; SDLC artifact types
-- (PRD | TECH_DOC | WIKI | <baseline kinds>) for SDLC-owned canvases.
ALTER TABLE "public"."canvases" ADD COLUMN "canvasType" TEXT NOT NULL DEFAULT 'DEFAULT';

-- Canvas lifecycle: ACTIVE | DRAFT (generating) | REFRESH_CANDIDATE (hidden staged refresh copy).
ALTER TABLE "public"."canvases" ADD COLUMN "canvasStatus" TEXT NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "canvases_channelId_canvasType_idx"
  ON "public"."canvases"("channelId", "canvasType");

CREATE INDEX "canvases_channelId_canvasType_canvasStatus_idx"
  ON "public"."canvases"("channelId", "canvasType", "canvasStatus");

-- Provenance for SDLC artifacts (one row per artifact; artifactId is a canvas id for now).
-- sourceReferences holds stringified JSON: [{path, commitSha, symbol?, startLine?, endLine?}]
CREATE TABLE "public"."sdlc_artifacts" (
  "workspaceId"         TEXT NOT NULL,
  "artifactId"          TEXT NOT NULL,
  "repoId"              TEXT NOT NULL,
  "workflowExecutionId" TEXT,
  "generationCommit"    TEXT,
  "sourceReferences"    TEXT,
  "sourcePaths"         TEXT,
  "createdBy"           TEXT NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sdlc_artifacts_pkey" PRIMARY KEY ("artifactId")
);

CREATE INDEX "sdlc_artifacts_repoId_idx"
  ON "public"."sdlc_artifacts"("repoId");

CREATE INDEX "sdlc_artifacts_workflowExecutionId_idx"
  ON "public"."sdlc_artifacts"("workflowExecutionId");

CREATE INDEX "sdlc_artifacts_workspaceId_idx"
  ON "public"."sdlc_artifacts"("workspaceId");

ALTER TABLE "public"."sdlc_artifacts"
  ADD CONSTRAINT "sdlc_artifacts_repoId_fkey" FOREIGN KEY ("repoId")
  REFERENCES "public"."repos"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SDLC tracks: named workstreams grouping PRD canvases and conversations
-- via nullable trackId columns (one track per item).
CREATE TABLE "public"."sdlc_tracks" (
  "workspaceId" TEXT NOT NULL,
  "id"          TEXT NOT NULL,
  "repoId"      TEXT NOT NULL,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "status"      TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdBy"   TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL,
  CONSTRAINT "sdlc_tracks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sdlc_tracks_repoId_fkey" FOREIGN KEY ("repoId")
    REFERENCES "public"."repos"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "sdlc_tracks_repoId_status_idx" ON "public"."sdlc_tracks"("repoId", "status");
CREATE INDEX "sdlc_tracks_workspaceId_idx" ON "public"."sdlc_tracks"("workspaceId");
