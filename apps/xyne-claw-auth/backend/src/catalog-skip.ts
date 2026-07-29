/**
 * Tool sources that must NEVER be seeded into the `tool` catalog as `custom:*`.
 *
 * google/microsoft are no longer in-process custom tools — they run as per-user
 * OAuth MCP connectors (type "google"/"microsoft"; see mcp/servers/google-server.ts).
 * Their tool defs still live in the shared registry (the MCP server reuses them),
 * so any code path that upserts `getAllCustomTools()` into the catalog MUST filter
 * these out, or the agent-config picker lists them under "custom tools" instead of
 * under connectors — and re-introduces the rows the catalog-cleanup migration
 * deleted. tool-sync surfaces them as `mcp:google`/`mcp:microsoft` instead.
 *
 * Single source of truth so bootstrap-tools.ts and routes/tools.ts can't drift.
 */
export const SKIP_CATALOG_SOURCES = new Set<string>([
  "custom:google",
  "custom:microsoft",
]);
