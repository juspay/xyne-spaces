-- Add Jusbiz Expense MCP server — remote streamable-HTTP MCP.
-- Endpoint: https://sandbox.expense.juspay.in/jusbiz-mcp/jusbiz-mcp/mcp
-- Auth: static HTTP Basic. The http adapter (src/mcp/adapters/jusbiz-mcp.ts)
-- supplies the url + Authorization header from the stored `authToken`
-- credential (the base64 value after "Basic "). This row is the catalog entry
-- + credential form; transport/url/headers come from the static adapter.
-- Health is verified by listing tools (__list_tools__) since tool names aren't
-- hardcoded yet.
INSERT INTO "mcp_servers"
  ("id", "type", "name", "url", "description", "transport",
   "credentialForm", "healthcheckSpec", "writeToolPolicy",
   "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'jusbiz-mcp',
  'Jusbiz Expense',
  'https://sandbox.expense.juspay.in/jusbiz-mcp/jusbiz-mcp/mcp',
  'Jusbiz expense MCP (sandbox) over remote streamable-HTTP. Static HTTP Basic auth — paste the base64 token (the value after "Basic ").',
  'http',
  '{"fields":[{"name":"authToken","label":"Basic auth token (base64)","type":"password","placeholder":"the value after ''Basic '' — e.g. Sk43V09SQkpOQUJNOVBWRg=="}]}'::jsonb,
  '{"name":"__list_tools__","params":{}}'::jsonb,
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
