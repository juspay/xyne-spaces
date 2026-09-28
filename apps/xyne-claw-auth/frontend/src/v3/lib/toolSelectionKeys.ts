// How one MCP tool is identified inside `agent.config.tools.direct`.
//
// This used to be the bare tool NAME, which silently merged tools that share a
// name across servers: `xyne-spaces` and `xyne-spaces-app-tools` publish 47
// identical names, so ticking a tool on one server ticked it on the other and
// saving granted both. The key is now server-scoped.
//
// The backend already understands the scoped form — `parseScopedDoubleUnderscore`
// in `backend/src/routes/mcp-agent-tools.ts` splits `<serverKey>__<toolName>`
// and matches it against `(serverType, tool.name)` — so no backend change is
// needed, and bare names stay readable for configs saved before this.
import { GATEWAY_SOURCE_PREFIX, parseGatewaySource } from "./gatewayKeys";

export interface CatalogTool {
  slug: string;
  name: string;
}

/**
 * The key written into `tools.direct` for one MCP tool.
 *
 * Gateway tools keep their `gateway:<service>:<backend>:<tool>` slug, which
 * already carries the routing target. Every other MCP tool uses its
 * server-scoped slug (`<serverType>__<toolName>`). The catalog mints slugs in
 * that shape; the fallback covers adapter-declared tools the `tools` table
 * hasn't synced yet, where the catalog sets slug === name.
 */
export const mcpSelectionKey = (source: string, tool: CatalogTool): string => {
  if (parseGatewaySource(source)) return tool.slug;
  return tool.slug.includes("__") ? tool.slug : `${source}__${tool.name}`;
};

/** True when `key` is a legacy bare tool name rather than a scoped/gateway key. */
export const isLegacyToolNameKey = (key: string): boolean =>
  !key.includes("__") && !key.startsWith(GATEWAY_SOURCE_PREFIX);

/**
 * Every server-scoped key a legacy bare-`name` entry would have granted.
 * `entries` is the non-gateway MCP catalog as `[source, tools]` pairs.
 */
export const scopedKeysForToolName = (
  entries: ReadonlyArray<readonly [string, ReadonlyArray<CatalogTool>]>,
  name: string,
): string[] =>
  entries.flatMap(([source, tools]) =>
    parseGatewaySource(source)
      ? []
      : tools.filter((t) => t.name === name).map((t) => mcpSelectionKey(source, t)),
  );

/**
 * Rewrites a legacy bare-name entry into explicit per-server keys. Config saved
 * before scoped keys existed grants the tool on *every* server publishing that
 * name — expanding preserves that meaning while letting the user untick one
 * server without silently dropping the other's copy.
 */
export const expandLegacyDirect = (
  entries: ReadonlyArray<readonly [string, ReadonlyArray<CatalogTool>]>,
  direct: readonly string[],
  toolName: string,
): string[] => {
  if (!direct.includes(toolName)) return [...direct];
  const scoped = scopedKeysForToolName(entries, toolName);
  if (scoped.length === 0) return [...direct];
  return [...new Set([...direct.filter((k) => k !== toolName), ...scoped])];
};
