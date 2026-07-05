-- Server-level "forward files" flag. When true, the MCP runner lifts binary
-- content (EmbeddedResource blob / image / audio) returned by ANY of this
-- server's tools into attachments forwarded to the user, instead of dropping it.
-- Surfaced via the resolved connector definition so the runner reads it without
-- a per-tool catalog query.
--
-- Replaces the earlier per-tool `tools.forwardFiles` flag: server-level is
-- sufficient because the extractor only ever acts on binary content (a text/
-- data tool on the same server returns text and is unaffected).

-- Drop the superseded per-tool column (IF EXISTS: present only where the earlier
-- migration ran, e.g. local; a no-op on environments that never had it).
ALTER TABLE "tools" DROP COLUMN IF EXISTS "forwardFiles";

ALTER TABLE "mcp_servers" ADD COLUMN "forwardFiles" BOOLEAN NOT NULL DEFAULT false;

-- Enable for the known file-returning connectors (no-op if a row isn't present).
UPDATE "mcp_servers" SET "forwardFiles" = true
WHERE "type" IN ('q-analytics-mcp');
