-- The durable record of a restore.
--
-- Restoring moves `artifact_apps.headVersionId` and nothing else: it is a
-- pointer, so once it lands the app is indistinguishable from one where that
-- version had always been current. No version row changes, and no chat message
-- is written. That made the act invisible — a thread whose newest generation is
-- v5 while the pane shows v2 had no explanation anywhere in it.
--
-- Not modelled as a `chat_messages` row on purpose: those form the branching
-- tree the transcript projects (parentId, sibling pagers, regenerate), so a
-- non-conversational node there would become a selectable branch and would put
-- a third value into a role column the client models as user|assistant.
CREATE TABLE "artifact_app_restores" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "appId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "fromVersionId" TEXT,
    "fromVersionNumber" INTEGER,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artifact_app_restores_pkey" PRIMARY KEY ("id")
);

-- The thread's read: every restore for one app, oldest first, to merge into the
-- transcript by time.
CREATE INDEX "artifact_app_restores_appId_createdAt_idx" ON "artifact_app_restores"("appId", "createdAt");

-- Tenant key carried on every table (see artifact_app_versions), so a query
-- that forgets to join the parent still cannot cross workspaces.
CREATE INDEX "artifact_app_restores_workspaceId_idx" ON "artifact_app_restores"("workspaceId");

-- Cascade: the events describe an app's history and mean nothing without it.
ALTER TABLE "artifact_app_restores"
    ADD CONSTRAINT "artifact_app_restores_appId_fkey"
    FOREIGN KEY ("appId") REFERENCES "artifact_apps"("id") ON DELETE CASCADE ON UPDATE CASCADE;
