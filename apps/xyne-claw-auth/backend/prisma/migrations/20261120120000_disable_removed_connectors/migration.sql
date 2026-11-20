-- Disable the salesforce, klaviyo, intercom and slack connectors.
UPDATE "mcp_servers" SET "enabled" = false, "updatedAt" = NOW() WHERE "type" IN ('salesforce', 'klaviyo', 'intercom', 'slack');
