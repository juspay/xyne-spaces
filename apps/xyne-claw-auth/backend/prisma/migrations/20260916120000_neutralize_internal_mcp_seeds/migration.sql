-- Neutralize the internal-infrastructure URLs and the credential-shaped
-- example token seeded by earlier migrations
-- (20260421180000_add_juspay_internal_tools_server and
--  20260629180000_add_jusbiz_mcp_server) so fresh databases match the
-- open-source-safe defaults.
--
-- Safe for internal deployments: these mcp_servers rows carry no
-- launchConfigTemplate / httpConfigTemplate, so resolveConnectorDefinition()
-- (src/mcp/connector-definitions.ts) resolves them through the code-defined
-- static adapters, whose transport URLs come from env (see
-- src/mcp/adapters/defaults.ts). The "url" column is catalog/display metadata
-- only, and "credentialForm" only describes the UI form — stored credentials
-- live elsewhere and are not touched.

UPDATE "mcp_servers"
SET "url" = 'http://localhost:8081/', "updatedAt" = NOW()
WHERE "type" = 'juspay-internal-tools';

UPDATE "mcp_servers"
SET "url" = 'http://localhost:8080/jusbiz-mcp/mcp', "updatedAt" = NOW(),
    "credentialForm" = jsonb_set(
      "credentialForm",
      '{fields,0,placeholder}',
      '"the base64 of your user:password pair (the value after ''Basic '')"'::jsonb,
      false
    )
WHERE "type" = 'jusbiz-mcp'
  AND jsonb_typeof("credentialForm") = 'object';
