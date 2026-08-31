/**
 * Single source of truth for which MCP server types authenticate via per-user
 * browser OAuth (a redirect/login flow) rather than a pasteable secret.
 *
 * Used by:
 *  - credentials-loader (resolution: OAuth types resolve via resolveFreshOAuthCreds)
 *  - the /servers API (decorates each server with `oauth` so the UI can tell
 *    OAuth connectors apart WITHOUT hardcoding a list in the frontend)
 *
 * A connector can also declare itself OAuth in the DB via
 * `connectorMeta.authMethod === "oauth"` (see isOAuthServer below) — the static
 * set covers the built-in google/microsoft connectors.
 */
export const OAUTH_SERVER_TYPES = new Set<string>(["google", "microsoft"]);

/** OAuth by built-in type. */
export function isOAuthServerType(type: string): boolean {
  return OAUTH_SERVER_TYPES.has(type);
}

/**
 * OAuth by built-in type, a DB-declared connectorMeta.authMethod="oauth", or
 * the explicit McpServer.isOauth flag (lets an admin-defined connector with
 * no code opt in purely via the DB).
 */
export function isOAuthServer(type: string, connectorMeta?: unknown, isOauth?: boolean): boolean {
  if (isOauth === true) return true;
  if (OAUTH_SERVER_TYPES.has(type)) return true;
  if (connectorMeta && typeof connectorMeta === "object") {
    const m = connectorMeta as Record<string, unknown>;
    if (m["authMethod"] === "oauth") return true;
  }
  return false;
}
