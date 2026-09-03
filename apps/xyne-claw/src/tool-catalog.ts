import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  SUBAGENT_DEFINITIONS,
  findSubagentDefinitionForServer,
  isPresentationToolSource,
  PRESENTATION_CATALOG_SOURCE,
} from "xyne-claw-shared";
import type { McpToolGroup } from "./mcp.js";
import type { CustomSubagentSpec } from "./subagent-tools.js";

export interface ToolCatalogEntry {
  name: string;
  oneLineDescription: string;
  /**
   * Provenance label: `subagent:<name>`, `custom-subagent:<name>`, or
   * `presentation`. routes/run.ts parses the `subagent:`/`custom-subagent:`
   * prefixes to apply the per-agent tools config, so this string's shape is
   * load-bearing — don't repurpose it for display.
   */
  source: string;
  /**
   * The catalog this tool belongs to — the user-facing grouping that
   * `search-tools`/`load-tools` filter on, and that the system-prompt index
   * lists. Derived from `source` at build time so the two can diverge without
   * breaking the config filter above.
   */
  catalog: string;
}

export interface ToolCatalogItem {
  entry: ToolCatalogEntry;
  tool: ToolDefinition;
}

export interface FastToolRuntimeController {
  getActiveToolSet?: () => string[];
  loadTools?: (names: string[]) => Promise<{
    loaded: string[];
    alreadyLoaded: string[];
    unknown: string[];
    activeToolSet: string[];
    maxActiveTools: number;
  }>;
}

const META_TOOL_NAMES = new Set(["search-tools", "load-tools"]);

function extractRuntimeToolName(name: string): string {
  const idx = name.lastIndexOf("__");
  return idx >= 0 ? name.slice(idx + 2) : name;
}

function oneLineDescription(tool: ToolDefinition): string {
  const raw = (tool.description || tool.promptSnippet || tool.label || tool.name)
    .replace(/\s+/g, " ")
    .trim();
  return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
}

function customToolSource(tool: ToolDefinition): string | undefined {
  return (tool as { source?: string }).source;
}

function customToolSelectionKey(tool: ToolDefinition): string {
  return (tool as { selectionKey?: string }).selectionKey ?? tool.name;
}

function isCustomWriteTool(tool: ToolDefinition): boolean {
  return (tool as { isWriteTool?: boolean }).isWriteTool === true;
}

function isDirectPick(tool: ToolDefinition, directPickSuffixes: string[] | undefined): boolean {
  if (!directPickSuffixes || directPickSuffixes.length === 0) return false;
  return directPickSuffixes.some((suffix) => tool.name.endsWith(suffix));
}

/** `subagent:github` → `github`; `presentation` → `presentation`. */
export function catalogNameForSource(source: string): string {
  const idx = source.indexOf(":");
  return idx >= 0 ? source.slice(idx + 1) : source;
}

function addUnique(items: ToolCatalogItem[], seen: Set<string>, tool: ToolDefinition, source: string): void {
  if (META_TOOL_NAMES.has(tool.name) || seen.has(tool.name)) return;
  seen.add(tool.name);
  items.push({
    tool,
    entry: {
      name: tool.name,
      oneLineDescription: oneLineDescription(tool),
      source,
      catalog: catalogNameForSource(source),
    },
  });
}

function resolveCustomSubagentTools(
  toolsConfig: { direct?: string[]; custom?: string[] },
  groups: McpToolGroup[],
  customTools: ToolDefinition[] | undefined,
): ToolDefinition[] {
  const directNames = new Set(toolsConfig.direct ?? []);
  const customSlugs = new Set(toolsConfig.custom ?? []);
  const out: ToolDefinition[] = [];

  if (directNames.size > 0) {
    for (const group of groups) {
      const writeSet = new Set(group.writeTools.map(String));
      for (const tool of group.tools) {
        const runtimeName = extractRuntimeToolName(tool.name);
        if (directNames.has(runtimeName) && !writeSet.has(runtimeName)) out.push(tool);
      }
    }
  }
  if (customSlugs.size > 0 && customTools) {
    for (const tool of customTools) {
      if (customSlugs.has(customToolSelectionKey(tool)) && !isCustomWriteTool(tool)) out.push(tool);
    }
  }
  return out;
}

export function buildToolCatalog(params: {
  groups: McpToolGroup[];
  customTools?: ToolDefinition[];
  customSubagents?: CustomSubagentSpec[];
  /**
   * Whether to catalogue subagent-wrapped read tools.
   *
   * Only meaningful when subagent delegation is OFF (fast mode) — there the
   * catalog stands in for the wrappers, so the individual read tools belong in
   * it. With delegation ON, the wrapper tool is already in the palette and
   * cataloguing its members too would show the model both `spaces` and
   * `Spaces__spaces-search`, which is duplication, not disclosure.
   *
   * Presentation tools are catalogued either way: they're wrapped by nothing.
   */
  includeSubagentTools?: boolean;
}): ToolCatalogItem[] {
  const items: ToolCatalogItem[] = [];
  const seen = new Set<string>();

  if (params.includeSubagentTools) {
    for (const group of params.groups) {
      const def = findSubagentDefinitionForServer(group.serverType);
      if (!def) continue;
      const writeSet = new Set(group.writeTools.map(String));
      for (const tool of group.tools) {
        if (writeSet.has(extractRuntimeToolName(tool.name))) continue;
        addUnique(items, seen, tool, `subagent:${def.name}`);
      }
    }

    if (params.customTools) {
      for (const def of SUBAGENT_DEFINITIONS) {
        const matched = params.customTools.filter((tool) => customToolSource(tool) === def.serverType);
        for (const tool of matched) {
          if (isCustomWriteTool(tool)) continue;
          addUnique(items, seen, tool, `subagent:${def.name}`);
        }
      }
    }

    for (const spec of params.customSubagents ?? []) {
      const palette = resolveCustomSubagentTools(spec.tools, params.groups, params.customTools);
      for (const tool of palette) {
        addUnique(items, seen, tool, `custom-subagent:${spec.name}`);
      }
    }
  }

  // Presentation tools (post-code-block / post-diff / post-chart / visualize)
  // aren't wrapped by any subagent, so the loops above skip them and they'd
  // otherwise fall through to remainingCustomTools → fastAlwaysActiveToolNames.
  // They're response-only: the agent needs them once it knows what to say, not
  // while it's still working. Catalogue them so load-tools pulls the schema in
  // at the point of use. Write-tool exclusion doesn't apply — they only render.
  // See packages/xyne-claw-shared/src/tools/presentation.ts.
  for (const tool of params.customTools ?? []) {
    if (isPresentationToolSource(customToolSource(tool))) {
      addUnique(items, seen, tool, PRESENTATION_CATALOG_SOURCE);
    }
  }

  return items;
}

export function buildFastModeDirectTools(params: {
  groups: McpToolGroup[];
  customTools?: ToolDefinition[];
  directPickSuffixes?: string[];
}): {
  directTools: ToolDefinition[];
  remainingCustomTools: ToolDefinition[];
} {
  const directTools: ToolDefinition[] = [];
  const remainingCustomTools: ToolDefinition[] = [];

  for (const group of params.groups) {
    const def = findSubagentDefinitionForServer(group.serverType);
    if (!def) {
      directTools.push(...group.tools);
      continue;
    }
    const writeSet = new Set(group.writeTools.map(String));
    for (const tool of group.tools) {
      const runtimeName = extractRuntimeToolName(tool.name);
      if (writeSet.has(runtimeName) || isDirectPick(tool, params.directPickSuffixes)) {
        directTools.push(tool);
      }
    }
  }

  for (const tool of params.customTools ?? []) {
    const source = customToolSource(tool);
    // Response-only cards go to the lazy catalog, never to the always-active
    // set — buildToolCatalog above claims them. This branch must come FIRST:
    // presentation tools are wrapped by no subagent, so the next check would
    // otherwise sweep them into remainingCustomTools, and a name that lands in
    // fastAlwaysActiveToolNames is filtered back OUT of the catalog in
    // routes/run.ts. Both halves have to agree or the tool is simply eager.
    if (isPresentationToolSource(source)) continue;
    const wrappedBySubagent = source
      ? findSubagentDefinitionForServer(source) !== undefined
      : false;
    if (!wrappedBySubagent) {
      remainingCustomTools.push(tool);
      continue;
    }
    if (isCustomWriteTool(tool) || isDirectPick(tool, params.directPickSuffixes)) {
      remainingCustomTools.push(tool);
    }
  }

  return { directTools, remainingCustomTools };
}

export function buildFastModeMetaTools(options: {
  catalog: ToolCatalogEntry[];
  controller: FastToolRuntimeController;
}): ToolDefinition[] {
  const catalog = [...options.catalog].sort((a, b) => a.name.localeCompare(b.name));
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));
  const renderList = (entries: ToolCatalogEntry[]): string =>
    entries
      .slice(0, 50)
      .map((entry) => `- ${entry.name} (${entry.source}): ${entry.oneLineDescription}`)
      .join("\n") + (entries.length > 50 ? `\n...and ${entries.length - 50} more. Narrow the query.` : "");
  /**
   * Never dead-end. A no-match search used to return a bare "No matching tools
   * found.", which left the model with nothing to act on — it would just stop.
   * Fall back to listing the pool instead, so it can still pick a name and call
   * load-tools. (Search is a hint, not an access boundary.)
   *
   * `pool` is the SCOPED set, not the whole catalog: falling back to everything
   * would quietly ignore the `catalog` filter the model just asked for.
   */
  const renderMatches = (matches: ToolCatalogEntry[], pool: ToolCatalogEntry[]): string => {
    if (matches.length === 0) {
      if (pool.length === 0) return "The tool catalog is empty — no loadable tools are configured for this agent.";
      const scope = pool.length === catalog.length ? "the full catalog" : `catalog ${JSON.stringify(pool[0]!.catalog)}`;
      return `No tool name/description matched that query. Showing ${scope} (${pool.length}) — pick the names you need and call load-tools:\n${renderList(pool)}`;
    }
    return renderList(matches);
  };

  const catalogNames = [...new Set(catalog.map((entry) => entry.catalog))].sort();
  /** Resolve the optional `catalog` filter, or return an error string. */
  const scopeTo = (raw: unknown): { entries: ToolCatalogEntry[] } | { error: string } => {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (!name) return { entries: catalog };
    if (!catalogNames.includes(name)) {
      return { error: `Error: unknown catalog ${JSON.stringify(name)}. Available: ${catalogNames.join(", ") || "(none)"}.` };
    }
    return { entries: catalog.filter((entry) => entry.catalog === name) };
  };

  return [
    {
      name: "search-tools",
      label: "Search Tools",
      description:
        "Search the tool catalog by name, catalog, or description. Use this before load-tools when you are unsure which tool you need. " +
        `Pass \`catalog\` to search within one catalog only; omit it to search all of them. Catalogs: ${catalogNames.join(", ") || "(none)"}.`,
      parameters: Type.Unsafe({
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Case-insensitive keyword or substring to search for." },
          catalog: {
            type: "string",
            ...(catalogNames.length > 0 ? { enum: catalogNames } : {}),
            description: "Optional. Restrict the search to one catalog. Omit to search every catalog.",
          },
        },
        required: ["query"],
      }),
      async execute(_toolCallId: string, params: unknown) {
        const input = params as { query?: unknown; catalog?: unknown } | undefined;
        const scoped = scopeTo(input?.catalog);
        if ("error" in scoped) {
          return { content: [{ type: "text" as const, text: scoped.error }], details: {} };
        }
        const pool = scoped.entries;
        const query = String(input?.query ?? "").trim().toLowerCase();
        if (!query) {
          return { content: [{ type: "text" as const, text: renderMatches(pool, pool) }], details: {} };
        }
        const tokens = query.split(/\s+/).filter(Boolean);
        // Rank by how many query tokens each entry matches (OR, not AND). The
        // old `tokens.every(...)` required EVERY word to appear in one tool's
        // name+source+description, so a natural query like "grafana query loki
        // clickhouse logs" matched nothing even when grafana tools existed.
        // Now any overlap surfaces the tool, best matches first.
        const matches = pool
          .map((entry) => {
            const haystack = `${entry.name} ${entry.catalog} ${entry.source} ${entry.oneLineDescription}`.toLowerCase();
            const hits = tokens.reduce((n, token) => (haystack.includes(token) ? n + 1 : n), 0);
            return { entry, hits };
          })
          .filter((s) => s.hits > 0)
          .sort((a, b) => b.hits - a.hits || a.entry.name.localeCompare(b.entry.name))
          .map((s) => s.entry);
        return { content: [{ type: "text" as const, text: renderMatches(matches, pool) }], details: {} };
      },
    },
    {
      name: "load-tools",
      label: "Load Tools",
      description:
        "Load full schemas for catalogued tools so you can call them directly on the next turn. Batch everything you need in one call. " +
        "Pass `names` for specific tools, or `catalog` to load a whole catalog at once (handy for small ones — no search needed first); " +
        `passing both loads the union. The loaded set is append-only for this session. Catalogs: ${catalogNames.join(", ") || "(none)"}.`,
      parameters: Type.Unsafe({
        type: "object",
        additionalProperties: false,
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            description: "Exact tool names from search-tools or the catalog index.",
          },
          catalog: {
            type: "string",
            ...(catalogNames.length > 0 ? { enum: catalogNames } : {}),
            description: "Optional. Load every tool in this catalog. Combine with `names` to also load tools from elsewhere.",
          },
        },
      }),
      async execute(_toolCallId: string, params: unknown) {
        if (!options.controller?.loadTools) {
          return { content: [{ type: "text" as const, text: "Error: tool loader is not initialized." }], details: {} };
        }
        const input = params as { names?: unknown; catalog?: unknown } | undefined;
        const scoped = scopeTo(input?.catalog);
        if ("error" in scoped) {
          return { content: [{ type: "text" as const, text: scoped.error }], details: {} };
        }
        // A `catalog` argument expands to its member names, so the controller
        // keeps its single names-based contract and the budget/append-only
        // accounting downstream is unchanged.
        const fromCatalog = typeof input?.catalog === "string" && input.catalog.trim()
          ? scoped.entries.map((entry) => entry.name)
          : [];
        const rawNames = input?.names;
        const explicit = Array.isArray(rawNames)
          ? rawNames.map((n) => String(n).trim()).filter(Boolean)
          : [];
        const names = [...new Set([...explicit, ...fromCatalog])];
        if (names.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: provide `names`, a `catalog`, or both." }],
            details: {},
          };
        }
        const unknown = names.filter((name) => !byName.has(name));
        const result = await options.controller.loadTools(names);
        const parts = [
          result.loaded.length > 0 ? `Loaded: ${result.loaded.join(", ")}` : "",
          result.alreadyLoaded.length > 0 ? `Already loaded: ${result.alreadyLoaded.join(", ")}` : "",
          [...unknown, ...result.unknown.filter((name) => !unknown.includes(name))].length > 0
            ? `Unknown: ${[...unknown, ...result.unknown.filter((name) => !unknown.includes(name))].join(", ")}`
            : "",
          `Active tools: ${result.activeToolSet.length}/${result.maxActiveTools}`,
          "Loaded tools are available starting with the next assistant turn.",
        ].filter(Boolean);
        return { content: [{ type: "text" as const, text: parts.join("\n") }], details: {} };
      },
    },
  ];
}

/**
 * Above this many entries a catalog is listed by name only and the model is
 * pointed at `search-tools`. At or below it, every tool is listed inline with
 * its one-liner — for a 3-4 tool catalog that costs almost nothing and saves
 * the model a search round trip before it can act.
 */
const INLINE_LISTING_MAX = 15;

/**
 * The system-prompt catalog index.
 *
 * Two-level disclosure, same shape as a skill's name+description: catalog names
 * (and, for small catalogs, tool names + one-liners) are always present, while
 * the full JSON schemas stay out until `load-tools` pulls them in. The model
 * always knows a tool EXISTS; it just doesn't carry the parameter schema until
 * it needs it.
 *
 * `subagentDelegationDisabled` controls one sentence: in fast mode the catalog
 * replaces delegation and the model must call these tools itself, whereas with
 * delegation on the catalog is purely additive and the claim would be false.
 */
export function renderToolCatalogForPrompt(
  catalog: ToolCatalogEntry[],
  opts?: { subagentDelegationDisabled?: boolean },
): string {
  if (catalog.length === 0) return "";

  const byCatalog = new Map<string, ToolCatalogEntry[]>();
  for (const entry of catalog) {
    const list = byCatalog.get(entry.catalog) ?? [];
    list.push(entry);
    byCatalog.set(entry.catalog, list);
  }

  const sections = [...byCatalog.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([name, entries]) => {
      const sorted = entries.slice().sort((a, b) => a.name.localeCompare(b.name));
      const header = `- **${name}** (${sorted.length} tool${sorted.length === 1 ? "" : "s"})`;
      if (sorted.length > INLINE_LISTING_MAX) {
        return [`${header} — search this catalog to see its tools.`];
      }
      return [header, ...sorted.map((entry) => `    - ${entry.name}: ${entry.oneLineDescription}`)];
    });

  return [
    "## Tool Catalogs",
    opts?.subagentDelegationDisabled
      ? "Subagent delegation is disabled. The tools below are NOT loaded yet — use `load-tools` to pull in the ones you need, then call them yourself."
      : "The tools below are NOT loaded yet — their full schemas arrive only when you ask for them.",
    "Use `search-tools` to find a tool, then `load-tools` to activate it; both take an optional `catalog` filter, and `load-tools` accepts a whole `catalog` at once. Loaded tools are callable from your next turn, so batch everything you need in one call.",
    ...sections,
  ].join("\n");
}
