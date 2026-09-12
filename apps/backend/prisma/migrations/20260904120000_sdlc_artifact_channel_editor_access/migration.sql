-- Grant repository-channel members edit access on existing PRD and Tech Doc artifacts.
--
-- SdlcHubService creates these canvases with SDLC_ARTIFACT_CANVAS_ROLE (EDITOR) for the
-- repository channel, but that only applies at creation time, so artifacts created before
-- the change still carry the read-only default. This brings them in line.
--
-- Scope is deliberately narrow:
--   * PRD and TECH_DOC only -- baselines and wiki pages keep VIEWER by design.
--   * Only the channel share (channelId set, userId/userGroupId null); individual and
--     group grants are explicit decisions and must not be silently promoted.
--   * Only rows still on VIEWER, so OWNER is preserved and re-running is a no-op.
UPDATE canvas_participants cp
SET role = 'EDITOR',
    "updatedAt" = NOW()
FROM sdlc_artifacts sa
WHERE sa."artifactId" = cp."canvasId"
  AND sa."artifactType" IN ('PRD', 'TECH_DOC')
  AND cp."channelId"   IS NOT NULL
  AND cp."userId"      IS NULL
  AND cp."userGroupId" IS NULL
  AND cp.role = 'VIEWER';
