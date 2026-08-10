-- Inbound file forwarding (user workspace file -> MCP tool as base64) toggle.
-- Mirrors mcp_servers.forwardFiles (the reverse, MCP -> user direction).
-- Replaces the CLAW_FILE_INPUT_FORWARDING_SERVERS env allowlist as the source of
-- truth; off by default so no server gains the capability implicitly.
ALTER TABLE "mcp_servers"
  ADD COLUMN "forwardFileInputs" BOOLEAN NOT NULL DEFAULT false;
