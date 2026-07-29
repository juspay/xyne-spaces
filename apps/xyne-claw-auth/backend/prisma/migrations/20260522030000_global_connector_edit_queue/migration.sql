-- Global-connector edit approval queue (post-ppi-grafana-v2 incident).
-- Every mutation to a McpServer row with connectorMeta.scope='global' must
-- now go through an admin review queue. routes/servers.ts inspects scope
-- on update; if global, it inserts an mcp_connector_edit_requests row
-- instead of mutating the live row directly.

CREATE TABLE "mcp_connector_edit_requests" (
  "id"               TEXT         NOT NULL,
  "mcpServerId"      TEXT         NOT NULL,
  "proposedByUserId" TEXT         NOT NULL,
  "proposedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "proposedFields"   JSONB        NOT NULL,
  "status"           TEXT         NOT NULL DEFAULT 'pending',
  "reviewedByUserId" TEXT,
  "reviewedAt"       TIMESTAMP(3),
  "reviewNote"       TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "mcp_connector_edit_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "mcp_connector_edit_requests_mcpServerId_status_idx"
  ON "mcp_connector_edit_requests" ("mcpServerId", "status");

CREATE INDEX "mcp_connector_edit_requests_status_createdAt_idx"
  ON "mcp_connector_edit_requests" ("status", "createdAt");

ALTER TABLE "mcp_connector_edit_requests"
  ADD CONSTRAINT "mcp_connector_edit_requests_mcpServerId_fkey"
  FOREIGN KEY ("mcpServerId") REFERENCES "mcp_servers"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Extend AgentAuditEvent enum for the queue lifecycle.
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_CONNECTOR_EDIT_REQUESTED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_CONNECTOR_EDIT_APPROVED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_CONNECTOR_EDIT_REJECTED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_CONNECTOR_EDIT_SUPERSEDED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_CONNECTOR_EDIT_CANCELLED';
