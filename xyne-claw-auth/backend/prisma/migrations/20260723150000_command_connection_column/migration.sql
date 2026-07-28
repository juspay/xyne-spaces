-- Promote commandConnectedSurfaceId out of the config blob: it is read at
-- dispatch time on every slash command, so by the promotion rule it must be a
-- real column. (commandAppId / commandRegisteredByUserId stay in config —
-- provenance only, never queried.)
ALTER TABLE "surface_agents" ADD COLUMN "commandConnectedSurfaceId" TEXT;

UPDATE "surface_agents"
SET "commandConnectedSurfaceId" = NULLIF(config->>'commandConnectedSurfaceId', '')
WHERE config ? 'commandConnectedSurfaceId';
