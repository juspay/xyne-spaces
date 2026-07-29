-- Extend AgentAuditEvent enum to cover connector-definition writes
-- (create / update / delete of `mcpServer` rows via POST /servers and
-- DELETE /servers/:id).
--
-- Why: routes/servers.ts mutates launchConfigTemplate, credentialForm,
-- credentialSchema, healthcheckSpec, writeToolPolicy, connectorMeta with
-- zero audit logging. The ppi-grafana-v2 incident on 2026-05-22 (env: {})
-- was untraceable past "three POSTs in 37 seconds on 2026-05-21 22:02-22:03"
-- because we don't capture actor or before/after.
--
-- Postgres requires enum additions to run outside a transaction block;
-- Prisma's migrate handles that, but each value is added individually.

ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_CONNECTOR_CREATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_CONNECTOR_UPDATED';
ALTER TYPE "AgentAuditEvent" ADD VALUE IF NOT EXISTS 'MCP_CONNECTOR_DELETED';
