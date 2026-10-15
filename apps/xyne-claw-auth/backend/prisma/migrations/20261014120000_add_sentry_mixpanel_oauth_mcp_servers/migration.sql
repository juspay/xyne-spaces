-- Catalog rows for the OAuth (browser sign-in) Sentry and Mixpanel connectors,
-- so they are listed before anyone connects. The token-based stdio rows
-- (type 'sentry' / 'mixpanel') are separate types and are untouched.
-- Health check, write tools and credential fields come from
-- src/mcp/adapters/{sentry,mixpanel}-remote.ts, not these rows.
-- Values mirror ensureServer() in src/lib/mcp-oauth-provider.ts.
-- DO NOTHING: safe to re-run; never overwrites a row created by a sign-in.
INSERT INTO "mcp_servers"
  ("id", "type", "name", "url", "description", "transport", "isOauth", "connectorMeta", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'sentry-remote', 'Sentry', 'https://mcp.sentry.dev/mcp',
   'Sentry — search issues, events, traces and logs, inspect stack traces, and triage or resolve issues.',
   'http', true, '{"scope":"global","mode":"self-serve"}'::jsonb, NOW(), NOW()),
  (gen_random_uuid()::text, 'mixpanel-remote', 'Mixpanel', 'https://mcp.mixpanel.com/mcp',
   'Mixpanel product analytics (US region) — run queries, explore events, funnels, retention, cohorts, dashboards, experiments and feature flags.',
   'http', true, '{"scope":"global","mode":"self-serve"}'::jsonb, NOW(), NOW())
ON CONFLICT ("type") DO NOTHING;
