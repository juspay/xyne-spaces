-- Add Neo4j (HTTP Query API) MCP server.
-- Talks to Neo4j over the HTTP Query API v2 (port 443) instead of Bolt (7687),
-- for environments where the Bolt port isn't reachable from the pod but the
-- HTTPS listener is. The stdio adapter (src/mcp/adapters/neo4j-http.ts)
-- launches src/mcp/servers/neo4j-http-server.ts. Same tool surface as the
-- official mcp-neo4j-cypher: get_neo4j_schema, read_neo4j_cypher,
-- write_neo4j_cypher. No launchConfigTemplate — the static adapter supplies
-- the launch command; this row is the catalog entry + credential form.
INSERT INTO "mcp_servers"
  ("id", "type", "name", "url", "description", "transport",
   "credentialForm", "healthcheckSpec", "writeToolPolicy",
   "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'neo4j-http',
  'Neo4j (HTTP Query API)',
  '',
  'Neo4j over the HTTP Query API v2 (port 443) instead of Bolt (7687) — use when the Bolt port isn''t reachable from the pod. Same tools as mcp-neo4j-cypher: get_neo4j_schema, read_neo4j_cypher, write_neo4j_cypher.',
  'stdio',
  '{"fields":[{"name":"url","label":"Neo4j HTTP base URL","type":"text","placeholder":"https://neo4j.infra.staging.in1.hyperswitch.net"},{"name":"database","label":"Database","type":"text","placeholder":"neo4j","optional":true},{"name":"username","label":"Username","type":"text","placeholder":"neo4j","optional":true},{"name":"password","label":"Password","type":"password","placeholder":"your-neo4j-password"},{"name":"readOnly","label":"Read-only (true/false)","type":"text","placeholder":"true","optional":true}]}'::jsonb,
  '{"name":"read_neo4j_cypher","params":{"query":"RETURN 1 AS ok"}}'::jsonb,
  '{"mode":"allowlist","tools":[]}'::jsonb,
  NOW(),
  NOW()
)
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "url" = EXCLUDED."url",
  "description" = EXCLUDED."description",
  "transport" = EXCLUDED."transport",
  "credentialForm" = EXCLUDED."credentialForm",
  "healthcheckSpec" = EXCLUDED."healthcheckSpec",
  "writeToolPolicy" = EXCLUDED."writeToolPolicy",
  "updatedAt" = NOW();
