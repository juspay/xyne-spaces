-- Add the xyne-spaces-app-tools MCP server row.
--
-- This server hosts bot-token write tools (apps-send-message etc.) — the
-- agent's spacesAppToken authenticates calls to /api/apps/* instead of
-- /api/* with the user's JWT. See:
--   • adapter:        src/mcp/adapters/xyne-spaces-app-tools.ts
--   • stdio server:   src/mcp/servers/xyne-spaces-app-tools-server.ts
--   • auto-connect:   src/routes/users.ts → autoConfigureSpaces
--
-- Before this migration the row was lazy-created the first time any user
-- POSTed to /users with a Spaces token (routes/users.ts:149-159). That
-- meant a fresh deploy had no row until at least one user logged in —
-- agents couldn't be attached to this MCP via the admin UI before that
-- moment. Migrating it explicitly so the row exists from boot.
--
-- The corresponding adapter declares `credentialFields: []` — there is
-- nothing for a human to configure. The app_token is sourced from the
-- default agent's spacesAppToken (encrypted, in agents.spacesAppToken)
-- and copied into user_mcp_connections at user-creation time by
-- autoConfigureSpaces. Zero-touch for users and admins.

INSERT INTO "mcp_servers" ("id", "type", "name", "url", "description", "createdAt", "updatedAt")
VALUES (
  gen_random_uuid()::text,
  'xyne-spaces-app-tools',
  'Xyne Spaces App Tools',
  '',
  'Bot/app-credential write tools for Xyne Spaces — uses agent app token (not user token). Auto-provisioned by autoConfigureSpaces; no manual config needed.',
  NOW(),
  NOW()
)
ON CONFLICT ("type") DO UPDATE SET
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "updatedAt" = NOW();
