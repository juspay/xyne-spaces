-- Add HubSpot, Mixpanel, and Amplitude MCP servers in a single migration.
-- Each row uses ON CONFLICT (type) DO UPDATE so the migration is idempotent
-- and safe to re-run if the same server already exists with stale fields.

INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'hubspot',   'HubSpot',   '', 'HubSpot CRM integration via @hubspot/mcp-server — contacts, companies, deals, tickets, engagements, properties.', NOW(), NOW()),
  (gen_random_uuid()::text, 'mixpanel',  'Mixpanel',  '', 'Mixpanel product-analytics integration via @mercuryml/mcp-mixpanel — query events, funnels, retention, cohorts.', NOW(), NOW()),
  (gen_random_uuid()::text, 'amplitude', 'Amplitude', '', 'Amplitude analytics integration via amplitude-mcp-server — emit track_event, track_pageview, track_signup, set_user_properties, track_revenue.', NOW(), NOW())
ON CONFLICT ("type") DO UPDATE SET
  "name"        = EXCLUDED."name",
  "url"         = EXCLUDED."url",
  "description" = EXCLUDED."description",
  "updatedAt"   = NOW();
