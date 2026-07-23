import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { SUBAGENT_DEFINITIONS } from "xyne-claw-shared";
import type { McpToolGroup } from "./mcp.js";
import type { CustomSubagentSpec } from "./subagent-tools.js";

export interface ToolCatalogEntry {
  name: string;
  oneLineDescription: string;
  source: string;
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

function addUnique(items: ToolCatalogItem[], seen: Set<string>, tool: ToolDefinition, source: string): void {
  if (META_TOOL_NAMES.has(tool.name) || seen.has(tool.name)) return;
  seen.add(tool.name);
  items.push({
    tool,
    entry: {
      name: tool.name,
      oneLineDescription: oneLineDescription(tool),
      source,
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
}): ToolCatalogItem[] {
  const items: ToolCatalogItem[] = [];
  const seen = new Set<string>();

  for (const group of params.groups) {
    const def = SUBAGENT_DEFINITIONS.find((d) => d.serverType === group.serverType);
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
    const def = SUBAGENT_DEFINITIONS.find((d) => d.serverType === group.serverType);
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
    const wrappedBySubagent = source
      ? SUBAGENT_DEFINITIONS.some((def) => def.serverType === source)
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
  const renderMatches = (matches: ToolCatalogEntry[]): string => {
    // Never dead-end. A no-match search used to return a bare "No matching
    // tools found.", which left the model with nothing to act on — it would
    // just stop. Instead fall back to the FULL catalog so it can still pick a
    // name and call load-tools. (Search is a hint, not an access boundary.)
    if (matches.length === 0) {
      if (catalog.length === 0) return "The fast-mode catalog is empty — no loadable tools are configured for this agent.";
      return `No tool name/description matched that query. Showing the full catalog (${catalog.length}) — pick the names you need and call load-tools:\n${renderList(catalog)}`;
    }
    return renderList(matches);
  };

  return [
    {
      name: "search-tools",
      label: "Search Tools",
      description: "Search the fast-mode tool catalog by name, source, or description. Use this before load-tools when you are unsure which direct tool you need.",
      parameters: Type.Unsafe({
        type: "object",
        additionalProperties: false,
        properties: {
          query: { type: "string", description: "Case-insensitive keyword or substring to search for." },
        },
        required: ["query"],
      }),
      async execute(_toolCallId: string, params: unknown) {
        const query = String((params as { query?: unknown } | undefined)?.query ?? "").trim().toLowerCase();
        if (!query) {
          return { content: [{ type: "text" as const, text: renderMatches(catalog) }], details: {} };
        }
        const tokens = query.split(/\s+/).filter(Boolean);
        // Rank by how many query tokens each entry matches (OR, not AND). The
        // old `tokens.every(...)` required EVERY word to appear in one tool's
        // name+source+description, so a natural query like "grafana query loki
        // clickhouse logs" matched nothing even when grafana tools existed.
        // Now any overlap surfaces the tool, best matches first.
        const matches = catalog
          .map((entry) => {
            const haystack = `${entry.name} ${entry.source} ${entry.oneLineDescription}`.toLowerCase();
            const hits = tokens.reduce((n, token) => (haystack.includes(token) ? n + 1 : n), 0);
            return { entry, hits };
          })
          .filter((s) => s.hits > 0)
          .sort((a, b) => b.hits - a.hits || a.entry.name.localeCompare(b.entry.name))
          .map((s) => s.entry);
        return { content: [{ type: "text" as const, text: renderMatches(matches) }], details: {} };
      },
    },
    {
      name: "load-tools",
      label: "Load Tools",
      description: "Load full schemas for fast-mode tools so you can call them directly on the next turn. Batch all needed names in one call. The loaded set is append-only for this session.",
      parameters: Type.Unsafe({
        type: "object",
        additionalProperties: false,
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            description: "Exact tool names from search-tools/catalog to load.",
          },
        },
        required: ["names"],
      }),
      async execute(_toolCallId: string, params: unknown) {
        if (!options.controller?.loadTools) {
          return { content: [{ type: "text" as const, text: "Error: fast-mode loader is not initialized." }], details: {} };
        }
        const rawNames = (params as { names?: unknown } | undefined)?.names;
        const names = Array.isArray(rawNames)
          ? rawNames.map((n) => String(n).trim()).filter(Boolean)
          : [];
        if (names.length === 0) {
          return { content: [{ type: "text" as const, text: "Error: provide at least one tool name to load." }], details: {} };
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

export function renderToolCatalogForPrompt(catalog: ToolCatalogEntry[]): string {
  if (catalog.length === 0) return "";
  const lines = catalog
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => `- ${entry.name} (${entry.source}): ${entry.oneLineDescription}`);
  return [
    "## Fast Mode Tool Catalog",
    "Subagent delegation is disabled. Use `search-tools` and `load-tools` to load direct tool schemas on demand, then call loaded tools yourself. Prefer loading every tool you need in one batch.",
    ...lines,
  ].join("\n");
}
