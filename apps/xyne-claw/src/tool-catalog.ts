import { jevEnabled, jevScoreItems, jevThreshold } from "./jev.js";
import { recordJudgeOutcome } from "./judge-backend.js";
import { optEnabled } from "./optimizations.js";
import { metric } from "./metrics.js";
import { runWithSubagentMcpId } from "./subagent-mcp-context.js";
import { Type } from "@sinclair/typebox";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  classifyToolRisk,
  riskAtOrBelow,
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
  /**
   * What the tool definition declared about mutating, so `search-tools`'
   * risk ceiling can use it instead of re-guessing from the name. Undefined
   * ≠ "read" — see `classifyToolRisk`.
   */
  isWrite?: boolean;
  /**
   * The MCP server this tool came from, when one did.
   *
   * Distinct from `catalog`: a subagent-wrapped server is catalogued under the
   * WRAPPER's name ("spaces"), while this stays the server's own type
   * ("xyne-spaces"). Loading or listing "everything from one MCP" needs the
   * second, and no other field carries it.
   */
  mcpServer?: string;
}

export interface ToolCatalogItem {
  entry: ToolCatalogEntry;
  tool: ToolDefinition;
}

/** One tool from the deployment-wide catalog, as claw-auth returns it. */
export interface DeploymentToolMatch {
  slug: string;
  name: string;
  integration: string;
  description: string;
  risk: "read" | "write" | "destructive";
  params: Array<{ name: string; type: string; required: boolean; description: string }>;
  grantedToAgents?: number;
}

/**
 * Searches every tool the deployment has, not just this run's.
 *
 * Injected, not imported: the catalog module is pure, but the lookup needs
 * the run's authenticated session. Absent (subagents, tests, a claw-auth
 * outage), `scope:"claw"` degrades to a clear message instead of erroring.
 */
export type DeploymentToolSearch = (params: {
  query: string;
  integration?: string;
  maxRisk?: string;
  limit: number;
}) => Promise<DeploymentToolMatch[]>;

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

const META_TOOL_NAMES = new Set(["load-tools", "search-tools"]);

/**
 * True when a catalogued tool is really a meta-tool under claw-auth's naming.
 *
 * The claw-auth System Tool `search_tools` answers exactly what `search-tools
 * scope:"claw"` does, and the UI title-cases both to the same untagged
 * "Search Tools" label — offering both makes a run trace unreadable, so the
 * System Tool is excluded whenever the meta-tools are present.
 */
export function duplicatesMetaTool(name: string): boolean {
  // Strip only the `Built-in__` prefix before comparing (the System Tool
  // arrives as `Built-in__search_tools`) — a third-party server's own
  // `search_tools` is not a duplicate.
  const runtime = extractRuntimeToolName(name);
  if (runtime !== name && !name.startsWith("Built-in__")) return false;
  return META_TOOL_NAMES.has(runtime.toLowerCase().replace(/_/g, "-"));
}

function extractRuntimeToolName(name: string): string {
  const idx = name.lastIndexOf("__");
  return idx >= 0 ? name.slice(idx + 2) : name;
}

export function oneLineDescription(tool: ToolDefinition): string {
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

function addUnique(
  items: ToolCatalogItem[],
  seen: Set<string>,
  tool: ToolDefinition,
  source: string,
  mcpServer?: string,
): void {
  if (duplicatesMetaTool(tool.name) || seen.has(tool.name)) return;
  seen.add(tool.name);
  items.push({
    tool,
    entry: {
      name: tool.name,
      oneLineDescription: oneLineDescription(tool),
      source,
      catalog: catalogNameForSource(source),
      ...(isCustomWriteTool(tool) ? { isWrite: true } : {}),
      ...(mcpServer ? { mcpServer } : {}),
    },
  });
}

export function subagentScopedToolName(subagentName: string, toolName: string): string {
  return `${subagentName}__${extractRuntimeToolName(toolName)}`.replace(/[^a-zA-Z0-9_-]/g, "_");
}

function scopeToSubagent(tool: ToolDefinition, subagentName: string, subagentId: string): ToolDefinition {
  const execute = tool.execute.bind(tool) as (...args: unknown[]) => unknown;
  return {
    ...tool,
    name: subagentScopedToolName(subagentName, tool.name),
    description: `[${subagentName}] ${tool.description ?? ""}`.trim(),
    execute: ((...args: unknown[]) => runWithSubagentMcpId(subagentId, () => execute(...args))) as ToolDefinition["execute"],
  } as ToolDefinition;
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
        if (directNames.has(runtimeName) && !(excludeWritesFromCatalog() && writeSet.has(runtimeName))) out.push(tool);
      }
    }
  }
  if (customSlugs.size > 0 && customTools) {
    for (const tool of customTools) {
      if (customSlugs.has(customToolSelectionKey(tool)) && !(excludeWritesFromCatalog() && isCustomWriteTool(tool))) out.push(tool);
    }
  }
  return out;
}

// Writes were skipped here so they could never be lazily loaded. With the
// parent-level force unwrap gone they would otherwise be unreachable, and
// prompt-residency was never the safety mechanism: every write queues a signed
// pendingAction that a human approves in claw-auth before it executes. Set
// XYNE_CATALOG_EXCLUDE_WRITES=1 to restore the old exclusion.
function excludeWritesFromCatalog(): boolean {
  return process.env["XYNE_CATALOG_EXCLUDE_WRITES"] === "1";
}

export function buildToolCatalog(params: {
  groups: McpToolGroup[];
  customTools?: ToolDefinition[];
  customSubagents?: CustomSubagentSpec[];
  /**
   * Whether to catalogue subagent-wrapped read tools.
   *
   * With delegation OFF (fast mode) the catalog stands in for the wrappers.
   * With delegation ON it is set by the open palette or `subagent_read_tools`,
   * so the model can load a subagent's tools and call them itself instead of
   * paying for a nested run.
   *
   * Presentation tools are catalogued either way: they're wrapped by nothing.
   */
  includeSubagentTools?: boolean;
  /**
   * Catalogues def-less servers' tools and in-process custom tools that no
   * subagent wraps. Set when the open palette is on, so these become
   * loadable instead of eager — a def-less server's tools otherwise go
   * straight to `directTools` (subagent-tools.ts) with full schemas in every
   * prompt. Granted tools are unaffected: `routes/run.ts` filters
   * always-active names back out of the catalog.
   */
  catalogUnwrapped?: boolean;
  catalogUnwrappedWrites?: boolean;
}): ToolCatalogItem[] {
  const items: ToolCatalogItem[] = [];
  const seen = new Set<string>();

  if (params.includeSubagentTools) {
    for (const group of params.groups) {
      if (group.sourceSubagent) continue;
      const def = findSubagentDefinitionForServer(group.serverType);
      if (!def) continue;
      const writeSet = new Set(group.writeTools.map(String));
      for (const tool of group.tools) {
        if (excludeWritesFromCatalog() && writeSet.has(extractRuntimeToolName(tool.name))) continue;
        addUnique(items, seen, tool, `subagent:${def.name}`, group.serverType);
      }
    }

    if (params.customTools) {
      for (const def of SUBAGENT_DEFINITIONS) {
        const matched = params.customTools.filter((tool) => customToolSource(tool) === def.serverType);
        for (const tool of matched) {
          if (excludeWritesFromCatalog() && isCustomWriteTool(tool)) continue;
          addUnique(items, seen, tool, `subagent:${def.name}`, def.serverType);
        }
      }
    }

    const serverOf = new Map<ToolDefinition, string>();
    for (const group of params.groups) {
      for (const tool of group.tools) serverOf.set(tool, group.serverType);
    }
    for (const spec of params.customSubagents ?? []) {
      const palette = resolveCustomSubagentTools(spec.tools, params.groups, params.customTools);
      for (const tool of palette) {
        const server = serverOf.get(tool);
        if (server && spec.id) {
          addUnique(items, seen, scopeToSubagent(tool, spec.name, spec.id), `custom-subagent:${spec.name}`, server);
        } else {
          addUnique(items, seen, tool, `custom-subagent:${spec.name}`, server);
        }
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

  if (params.catalogUnwrapped) {
    // Def-less servers, under the same `server:<type>` pseudo-source
    // tool-resolution.ts already uses for them.
    for (const group of params.groups) {
      if (group.sourceSubagent) continue;
      if (findSubagentDefinitionForServer(group.serverType)) continue;
      const writeSet = new Set(group.writeTools.map(String));
      for (const tool of group.tools) {
        if (!params.catalogUnwrappedWrites && writeSet.has(extractRuntimeToolName(tool.name))) continue;
        addUnique(items, seen, tool, `server:${group.serverType}`, group.serverType);
      }
    }

    // In-process custom tools with no MCP server behind them. Writes stay eager:
    // a write tool is something an admin picked deliberately, and the palette
    // refuses writes at "read" anyway.
    for (const tool of params.customTools ?? []) {
      const source = customToolSource(tool);
      if (!source || isPresentationToolSource(source)) continue;
      if (!params.catalogUnwrappedWrites && isCustomWriteTool(tool)) continue;
      addUnique(items, seen, tool, source);
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
    if (group.sourceSubagent) continue;
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

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 50;

/** The one result shape a meta-tool returns. */
function text(body: string): { content: Array<{ type: "text"; text: string }>; details: Record<string, never> } {
  return { content: [{ type: "text" as const, text: body }], details: {} };
}

/**
 * Risk for a catalog entry, using the same classifier as the index and the
 * Toolbox badge. The entry's `isWrite` is believed when present; otherwise the
 * name decides, leaning write.
 */
function entryRisk(entry: ToolCatalogEntry): ReturnType<typeof classifyToolRisk> {
  return classifyToolRisk(entry.name, entry.isWrite);
}

/** Ranked hit from the agent-scope matcher. */
interface ScopedHit {
  entry: ToolCatalogEntry;
  hits: number;
}

/**
 * Token overlap over name, catalog, source and one-liner, ranked by hit
 * count — OR not AND, so a multi-word query still matches tools that contain
 * only some of the words. Tokens under MIN_TOKEN are dropped: matching is by
 * substring, so a 1-2 letter token is contained in nearly every description
 * and would swamp the ranking. Lexical, not semantic: this is the agent's own
 * (small, already-prompted) palette — `scope:"claw"` is the vector search for
 * the deployment-wide catalog the model hasn't seen.
 */
const MIN_TOKEN = 3;

function matchScoped(entries: ToolCatalogEntry[], query: string): ToolCatalogEntry[] {
  const tokens = query.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= MIN_TOKEN);
  if (tokens.length === 0) return entries;
  return entries
    .map((entry): ScopedHit => {
      const haystack = `${entry.name} ${entry.catalog} ${entry.source} ${entry.oneLineDescription}`.toLowerCase();
      return { entry, hits: tokens.reduce((n, token) => (haystack.includes(token) ? n + 1 : n), 0) };
    })
    .filter((s) => s.hits > 0)
    .sort((a, b) => b.hits - a.hits || a.entry.name.localeCompare(b.entry.name))
    .map((s) => s.entry);
}

/**
 * Keyword hits first, then anything Jev scores as relevant that the keywords
 * missed. The union is deliberate: substring matching finds nothing for
 * "average first response time" against `spaces-desk-metrics`, but dropping
 * what it does catch would be a regression for the phrasings it handles.
 */
async function matchScopedSifted(
  entries: ToolCatalogEntry[],
  query: string,
): Promise<ToolCatalogEntry[]> {
  const keyword = matchScoped(entries, query);
  if (!optEnabled("jev_tool_sift") || !jevEnabled()) return keyword;

  const already = new Set(keyword.map((e) => e.name));
  const scores = await jevScoreItems(query, entries, {
    purpose: "tool-search",
    key: (e) => e.name,
    instructions: (e) =>
      `Would calling this tool help with the request? \`${e.name}\`: ` +
      `${e.oneLineDescription.slice(0, 300)}`,
  });
  if (!scores) return keyword;

  const threshold = jevThreshold("JEV_TOOL_THRESHOLD", 0.4);
  const added = entries
    .filter((e) => !already.has(e.name) && (scores.get(e.name) ?? 0) >= threshold)
    .sort((a, b) => (scores.get(b.name) ?? 0) - (scores.get(a.name) ?? 0));

  if (added.length > 0) {
    metric.count("tool_search_sift_added", { added: added.length, keyword: keyword.length });
  }
  recordJudgeOutcome(
    "tool-search",
    `scored ${scores.size} of ${entries.length} tools · keyword hits ${keyword.length} · added ${added.length} at ≥${threshold}`,
    {
      query,
      threshold,
      added: added.slice(0, 25).map((e) => ({ name: e.name, score: Number((scores.get(e.name) ?? 0).toFixed(3)) })),
      keywordHits: keyword.slice(0, 25).map((e) => ({ name: e.name, score: Number((scores.get(e.name) ?? 0).toFixed(3)) })),
    },
  );
  return [...keyword, ...added];
}

/**
 * Resolves a name the model typed to the name the catalog actually holds.
 *
 * Agent-scope search quotes server-decorated runtime names (e.g.
 * `Xyne_Spaces__spaces-my-items`); deployment scope quotes the bare `tools`
 * table name and can't know this run's prefixes. Tried in descending
 * confidence; an ambiguous suffix match is reported rather than guessed —
 * two servers can share a bare tool name, and loading the wrong one silently
 * is worse than asking for the qualified name.
 */
export function normalizeToolName(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_]+/g, "-");
}

function resolveCatalogName(
  requested: string,
  byName: Map<string, ToolCatalogEntry>,
  catalog: ToolCatalogEntry[],
): { name: string } | { ambiguous: string[] } | null {
  if (byName.has(requested)) return { name: requested };

  const wanted = normalizeToolName(requested);
  const norm = normalizeToolName;

  const matches = catalog.filter((entry) => {
    const name = entry.name;
    return (
      norm(name) === wanted ||
      name.endsWith(`__${requested}`) ||
      norm(name).endsWith(`--${wanted}`) ||
      norm(extractRuntimeToolName(name)) === wanted
    );
  });

  if (matches.length === 1) return { name: matches[0]!.name };
  if (matches.length > 1) return { ambiguous: matches.map((m) => m.name) };
  return null;
}

/**
 * Explains an unresolved name using what this run actually holds, so
 * "unknown" reads as a diagnosis (wrong name vs. genuinely not in this run)
 * rather than a dead end. Not reached for an empty catalog — `execute`
 * returns `emptyCatalogMessage` before resolving anything.
 */
function unknownExplanation(unknown: string[], catalog: ToolCatalogEntry[]): string {
  const head = `Unknown: ${unknown.join(", ")}.`;
  const byCatalog = [...new Set(catalog.map((e) => e.catalog))].sort();
  const sample = catalog.slice(0, 8).map((e) => e.name);
  return `${head} This run holds ${catalog.length} loadable tool(s) across ${byCatalog.join(", ")} — ` +
    `for example: ${sample.join(", ")}${catalog.length > sample.length ? ", …" : ""}. ` +
    'Call search-tools with scope="agent" to search them. A tool the deployment has but this run does ' +
    "not means its integration has no credentials here, and no palette setting changes that.";
}

/** Groups entries under their catalog headings, the browse view. */
function renderGrouped(entries: ToolCatalogEntry[], header: string): string {
  const grouped = new Map<string, ToolCatalogEntry[]>();
  for (const entry of entries) {
    const list = grouped.get(entry.catalog) ?? [];
    list.push(entry);
    grouped.set(entry.catalog, list);
  }
  const sections = [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, group]) => {
      const sorted = group.slice().sort((a, b) => a.name.localeCompare(b.name));
      return [
        `## ${name} (${sorted.length})`,
        ...sorted.map((e) => `  - ${e.name} [${entryRisk(e)}]: ${e.oneLineDescription}`),
      ].join("\n");
    });
  return [header, ...sections].join("\n\n");
}

function renderDeployment(matches: DeploymentToolMatch[], note: string): string {
  if (matches.length === 0) {
    return "No tools in this deployment match that. Try fewer constraints, or describe the task differently.";
  }
  const lines = matches.map((m) => {
    const required = m.params.filter((p) => p.required).map((p) => p.name);
    const params = required.length ? ` — needs ${required.join(", ")}` : "";
    const granted = typeof m.grantedToAgents === "number" ? `, granted to ${m.grantedToAgents} agent(s)` : "";
    return `  - ${m.name} [${m.integration}, ${m.risk}${granted}]${params}\n      ${m.description.replace(/\s+/g, " ").slice(0, 200)}`;
  });
  return [`Deployment catalog — ${matches.length} match${matches.length === 1 ? "" : "es"}.`, ...lines, "", note].join("\n");
}

/** One MCP server this run is connected to, as search-tools reports it. */
export interface McpServerSummary {
  serverType: string;
  serverName: string;
  /** Tools the server exposes in this run, before any catalog filtering. */
  tools: number;
  /** Set when a subagent wrapper owns the server; its tools are reached through
   *  that wrapper rather than loaded individually. */
  wrappedBy?: string;
}

/**
 * The connected MCP servers, independent of what got catalogued.
 *
 * Built from the groups rather than from catalog entries on purpose: a server
 * whose tools are all behind a subagent wrapper, or all writes, contributes no
 * catalog entries at all, and answering "which MCPs am I connected to" with
 * silence about it would be wrong.
 */
export function describeMcpServers(groups: McpToolGroup[]): McpServerSummary[] {
  const byType = new Map<string, McpServerSummary>();
  for (const group of groups) {
    const existing = byType.get(group.serverType);
    if (existing) {
      existing.tools += group.tools.length;
      continue;
    }
    const wrapper = group.sourceSubagent?.name ?? findSubagentDefinitionForServer(group.serverType)?.name;
    byType.set(group.serverType, {
      serverType: group.serverType,
      serverName: group.serverName,
      tools: group.tools.length,
      ...(wrapper ? { wrappedBy: wrapper } : {}),
    });
  }
  return [...byType.values()].sort((a, b) => a.serverType.localeCompare(b.serverType));
}

export function buildFastModeMetaTools(options: {
  catalog: ToolCatalogEntry[];
  controller: FastToolRuntimeController;
  /**
   * Extra detail appended to the empty-catalog answer of search-tools/load-tools,
   * e.g. which configured subagents resolved to zero tools. The runtime loader
   * is only wired when the catalog has entries (see agent.ts), so without this
   * an empty catalog answered load-tools with the internal-sounding
   * "tool loader is not initialized".
   */
  emptyCatalogNote?: string;
  /** Backs `scope:"claw"`. Absent → that scope answers with why. */
  searchDeployment?: DeploymentToolSearch;
  /** True when this agent may load tools it was never granted. Decides only
   *  what the deployment-scope answer tells the model to do next. */
  openPalette?: boolean;
  /** Connected MCP servers, for `scope:"mcp"`. Empty when none are wired. */
  mcpServers?: McpServerSummary[];
  activeTools?: ToolCatalogEntry[];
}): ToolDefinition[] {
  const catalog = [...options.catalog].sort((a, b) => a.name.localeCompare(b.name));
  const emptyCatalogMessage = [
    "No loadable tools are configured for this agent.",
    options.emptyCatalogNote?.trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const byName = new Map(catalog.map((entry) => [entry.name, entry]));

  const catalogNames = [...new Set(catalog.map((entry) => entry.catalog))].sort();
  const mcpServers = options.mcpServers ?? [];
  // Every server the run is connected to, plus any the catalog names on its own,
  // so the enum still guides the model when `mcpServers` was not supplied.
  const mcpServerTypes = [
    ...new Set([
      ...mcpServers.map((server) => server.serverType),
      ...catalog.flatMap((entry) => (entry.mcpServer ? [entry.mcpServer] : [])),
    ]),
  ].sort();
  const entriesForMcp = (serverType: string): ToolCatalogEntry[] =>
    catalog.filter((entry) => entry.mcpServer === serverType);
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
        "Find a tool. Covers two different questions, and `scope` picks which one.\n" +
        `scope="agent" (the default) looks at the tools THIS run can use. Everything it returns is loadable right now — pass the exact names to load-tools and they are callable on your next turn. Catalogs: ${catalogNames.join(", ") || "(none)"}.\n` +
        'scope="claw" looks at every tool the deployment has, including ones this agent was never given. Use it to find out what exists at all — planning work, configuring another agent, or checking whether a capability is even available here. Results are not necessarily loadable; the answer says which.\n' +
        'scope="mcp" answers "which MCP servers am I connected to". On its own it lists them with their tool counts; add `mcp` to list one server\'s tools. Use it when the ask names a system ("anything from Heisenberg?") rather than a task.\n' +
        "Omit `query` to browse the whole scope. Pass `query` to narrow it, and describe what you are trying to DO rather than guessing a tool name — \"post a message to a channel\", \"fill in a pdf form\". Agent scope matches on words, so keywords work; claw scope is a semantic search, so a full phrase works better than a single noun.\n" +
        "`catalog` narrows the agent scope to one catalog; `integration` narrows the claw scope to one product (google, sandbox, github). `maxRisk` is a ceiling, not an exact match: \"read\" excludes everything that writes, \"write\" still excludes destructive. Use it when you only need to look something up.\n" +
        (options.activeTools
          ? "Only for tools you do not already have: if a tool already in your tool list fits, call it directly — no search or load needed. When you do search, matching tools that are already active are listed first."
          : "Call it before guessing a tool name. A wrong name costs a failed call; a search costs one cheap round trip."),
      parameters: Type.Unsafe({
        type: "object",
        additionalProperties: false,
        properties: {
          query: {
            type: "string",
            description: "What you are trying to do, in plain words. Omit to list everything in scope.",
          },
          scope: {
            type: "string",
            enum: ["agent", "claw", "mcp"],
            description:
              '"agent" (default) = tools this run can load. "claw" = every tool the deployment has, whether or not this agent holds it. "mcp" = the connected MCP servers themselves.',
          },
          catalog: {
            type: "string",
            ...(catalogNames.length > 0 ? { enum: catalogNames } : {}),
            description: "Agent scope only. Restrict to one catalog.",
          },
          integration: {
            type: "string",
            description: 'Claw scope only. Restrict to one integration, e.g. "google" or "sandbox".',
          },
          mcp: {
            type: "string",
            ...(mcpServerTypes.length > 0 ? { enum: mcpServerTypes } : {}),
            description:
              'One MCP server, by its server type. In "mcp" scope it lists that server\'s tools; in "agent" scope it restricts results to that server. Not the same as `catalog`: a wrapped server is catalogued under its subagent name.',
          },
          maxRisk: {
            type: "string",
            enum: ["read", "write", "destructive"],
            description: "Ceiling on how dangerous a returned tool may be. Omit for no ceiling.",
          },
          limit: { type: "number", description: "Maximum results. Default 10, max 50." },
        },
      }),
      async execute(_toolCallId: string, params: unknown) {
        const input = (params ?? {}) as {
          query?: unknown; scope?: unknown; catalog?: unknown; integration?: unknown;
          maxRisk?: unknown; limit?: unknown; mcp?: unknown;
        };
        const query = typeof input.query === "string" ? input.query.trim() : "";
        const limit = Math.min(Math.max(Number(input.limit) || DEFAULT_SEARCH_LIMIT, 1), MAX_SEARCH_LIMIT);
        const maxRisk = typeof input.maxRisk === "string" ? input.maxRisk : undefined;
        const mcp = typeof input.mcp === "string" ? input.mcp.trim() : "";

        if (input.scope === "mcp") {
          if (mcp) {
            const known = mcpServers.find((server) => server.serverType === mcp);
            const entries = entriesForMcp(mcp);
            if (!known && entries.length === 0) {
              return text(
                `No MCP server "${mcp}" in this run. Connected: ${mcpServerTypes.join(", ") || "(none)"}.`,
              );
            }
            if (entries.length === 0) {
              // Connected, but nothing individually loadable: every tool sits
              // behind a wrapper or is a write the catalog never takes.
              return text(
                `${mcp} is connected${known?.wrappedBy ? ` and handled by the "${known.wrappedBy}" tool` : ""}, ` +
                `but none of its ${known?.tools ?? 0} tool(s) are individually loadable here` +
                `${known?.wrappedBy ? `. Call "${known.wrappedBy}" instead.` : "."}`,
              );
            }
            return text(
              `${mcp} — ${entries.length} loadable tool(s). load-tools({ mcp: "${mcp}" }) takes all of them.\n\n` +
              renderGrouped(entries.slice(0, limit), "") +
              (entries.length > limit ? `\n\n…and ${entries.length - limit} more; raise \`limit\` to see them.` : ""),
            );
          }
          if (mcpServers.length === 0) {
            return text("No MCP servers are connected in this run.");
          }
          const lines = mcpServers.map((server) => {
            const loadable = entriesForMcp(server.serverType).length;
            const wrapped = server.wrappedBy ? `, reached through "${server.wrappedBy}"` : "";
            return `  - ${server.serverType} (${server.serverName}): ${server.tools} tool(s)${wrapped}, ${loadable} individually loadable`;
          });
          return text(
            `${mcpServers.length} connected MCP server(s):\n${lines.join("\n")}\n\n` +
            'Add `mcp` to list one server\'s tools, or call load-tools({ mcp: "<server>" }) to take them all.',
          );
        }

        if (input.scope === "claw") {
          if (!options.searchDeployment) {
            return text(
              "The deployment-wide catalog is not reachable from this run. " +
              'Use scope="agent" to search the tools already available here.',
            );
          }
          const matches = await options.searchDeployment({
            query,
            limit,
            ...(typeof input.integration === "string" && input.integration.trim()
              ? { integration: input.integration.trim() }
              : {}),
            ...(maxRisk ? { maxRisk } : {}),
          }).catch((err: unknown) => (err instanceof Error ? err.message : String(err)));
          if (typeof matches === "string") {
            // Surface the real error (404 vs 403 vs timeout) rather than a
            // generic "could not reach" message.
            return text(
              `Could not reach the deployment catalog: ${matches.slice(0, 200)}. ` +
              'scope="agent" still works and covers everything this run can load.',
            );
          }
          // Telling a restricted agent to load-tools one of these yields
          // "unknown", which reads as a broken tool, not a permission
          // boundary — hence the distinct wording below. openPalette only
          // waives the grant requirement; it can't conjure credentials, so a
          // tool whose integration was never connected still isn't loadable.
          return text(renderDeployment(matches, options.openPalette
            ? "This agent has an open palette, so try load-tools with the exact name. "
              + 'A name that comes back "unknown" is not in this run at all — its integration has no '
              + "credentials here, and no palette setting changes that."
            : "These are NOT loadable in this run: this agent only loads what it was granted. "
              + 'Re-run with scope="agent" to see what is, or ask an admin to grant one of the above.'));
        }

        const scoped = scopeTo(input.catalog);
        if ("error" in scoped) return text(scoped.error);
        const activeAllowed = maxRisk ? new Set(riskAtOrBelow(maxRisk as "read" | "write" | "destructive")) : null;
        const activeHits =
          query && options.activeTools && !input.catalog && !mcp
            ? matchScoped(options.activeTools, query).filter((e) => !activeAllowed || activeAllowed.has(entryRisk(e)))
            : [];
        const activeSection = activeHits.length
          ? [
              `## already active — call directly, no search or load needed (${activeHits.length})`,
              ...activeHits.slice(0, limit).map((e) => `  - ${e.name}: ${e.oneLineDescription}`),
            ].join("\n")
          : "";
        if (scoped.entries.length === 0) {
          if (activeSection) return text(`${activeHits.length} tool(s) you already have match ${JSON.stringify(query)} — call them directly.\n\n${activeSection}`);
          return text(`The tool catalog is empty. ${emptyCatalogMessage}`);
        }
        if (mcp && !mcpServerTypes.includes(mcp)) {
          return text(`No MCP server "${mcp}" in this run. Connected: ${mcpServerTypes.join(", ") || "(none)"}.`);
        }
        const byServer = mcp ? scoped.entries.filter((e) => e.mcpServer === mcp) : scoped.entries;

        const allowed = maxRisk ? new Set(riskAtOrBelow(maxRisk as "read" | "write" | "destructive")) : null;
        const risked = allowed ? byServer.filter((e) => allowed.has(entryRisk(e))) : byServer;
        const matched = query ? await matchScopedSifted(risked, query) : risked;
        if (matched.length === 0 && activeSection) {
          return text(`Nothing to load matches ${JSON.stringify(query)}, but ${activeHits.length} tool(s) you already have do — call them directly.\n\n${activeSection}`);
        }
        if (matched.length === 0) {
          return text(
            `No tool in this agent's catalog matches ${JSON.stringify(query)}. ` +
            `${risked.length} tool(s) are available here — call search-tools with no query to browse them, ` +
            'or scope="claw" to check whether the deployment has one this agent was not given.',
          );
        }

        const shown = matched.slice(0, limit);
        const header =
          `${shown.length} of ${matched.length} matching tool(s)${query ? ` for ${JSON.stringify(query)}` : ""}. ` +
          'Pick the names you need and call load-tools({ names: [...] }), or load-tools({ catalog: "<name>" }) for a whole catalog.';
        const grouped = renderGrouped(shown, header);
        return text(activeSection ? `${activeSection}\n\n${grouped}` : grouped);
      },
    },
    {
      name: "load-tools",
      label: "Load Tools",
      description:
        "Activate tools so you can call them directly. Their full schemas arrive on your NEXT turn, so batch everything you need into one call rather than loading one at a time.\n" +
        "Pass `names` for specific tools — one name or many, exactly as search-tools spelled them. Pass `catalog` to take a whole catalog at once, which is worth doing for small ones instead of searching first. Pass `mcp` to take everything one MCP server exposes here. Any combination loads the union.\n" +
        "The loaded set only grows: nothing you load is taken away later in this session, so there is no need to re-load a tool you already have. " +
        `Only tools in this agent's catalog can be loaded; if a name comes back "unknown", search-tools with scope="agent" will show what is actually here. Catalogs: ${catalogNames.join(", ") || "(none)"}.`,
      parameters: Type.Unsafe({
        type: "object",
        additionalProperties: false,
        properties: {
          names: {
            type: "array",
            items: { type: "string" },
            description: "Exact tool names, as search-tools or the catalog index spelled them.",
          },
          catalog: {
            type: "string",
            ...(catalogNames.length > 0 ? { enum: catalogNames } : {}),
            description: "Optional. Load every tool in this catalog. Combine with `names` to also load tools from elsewhere.",
          },
          mcp: {
            type: "string",
            ...(mcpServerTypes.length > 0 ? { enum: mcpServerTypes } : {}),
            description:
              'Optional. Load every loadable tool from one MCP server, by server type. Use search-tools with scope="mcp" to see which are connected.',
          },
        },
      }),
      async execute(_toolCallId: string, params: unknown) {
        if (catalog.length === 0) {
          return { content: [{ type: "text" as const, text: emptyCatalogMessage }], details: {} };
        }
        if (!options.controller?.loadTools) {
          return { content: [{ type: "text" as const, text: "Error: tool loader is not initialized." }], details: {} };
        }
        const input = params as { names?: unknown; catalog?: unknown; mcp?: unknown } | undefined;
        const scoped = scopeTo(input?.catalog);
        if ("error" in scoped) {
          return { content: [{ type: "text" as const, text: scoped.error }], details: {} };
        }
        const wantMcp = typeof input?.mcp === "string" ? input.mcp.trim() : "";
        if (wantMcp && !mcpServerTypes.includes(wantMcp)) {
          return {
            content: [{ type: "text" as const, text: `No MCP server "${wantMcp}" in this run. Connected: ${mcpServerTypes.join(", ") || "(none)"}.` }],
            details: {},
          };
        }
        const fromMcp = wantMcp ? entriesForMcp(wantMcp).map((entry) => entry.name) : [];
        if (wantMcp && fromMcp.length === 0) {
          const known = mcpServers.find((server) => server.serverType === wantMcp);
          return {
            content: [{ type: "text" as const, text:
              `${wantMcp} is connected but exposes nothing individually loadable here` +
              `${known?.wrappedBy ? `. Call "${known.wrappedBy}" instead.` : "."}` }],
            details: {},
          };
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
        const names = [...new Set([...explicit, ...fromCatalog, ...fromMcp])];
        if (names.length === 0) {
          return {
            content: [{ type: "text" as const, text: "Error: provide `names`, a `catalog`, an `mcp`, or any combination." }],
            details: {},
          };
        }
        const resolved: string[] = [];
        const unknown: string[] = [];
        const ambiguous: string[] = [];
        const alreadyActive: string[] = [];
        const activeByName = new Map((options.activeTools ?? []).map((e) => [e.name, e]));
        const activeMatch = (requested: string): string | null => {
          if (activeByName.has(requested)) return requested;
          const wanted = normalizeToolName(requested.split("__").pop() ?? requested);
          const hits = [...activeByName.keys()].filter(
            (n) => normalizeToolName(n) === normalizeToolName(requested) || normalizeToolName(n.split("__").pop() ?? n) === wanted,
          );
          return hits.length === 1 ? hits[0]! : null;
        };
        for (const requested of names) {
          const hit = resolveCatalogName(requested, byName, catalog);
          const active = hit === null ? activeMatch(requested) : null;
          if (active) alreadyActive.push(active);
          else if (hit === null) unknown.push(requested);
          else if ("ambiguous" in hit) ambiguous.push(`${requested} (could be ${hit.ambiguous.join(" or ")})`);
          else resolved.push(hit.name);
        }

        // Call even with nothing resolved: it's the only source of the real
        // active-set/budget numbers — skipping it would fake "0/0".
        const result = await options.controller.loadTools(resolved);

        const allUnknown = [...unknown, ...result.unknown.filter((name) => !unknown.includes(name))];
        const parts = [
          result.loaded.length > 0 ? `Loaded: ${result.loaded.join(", ")}` : "",
          result.alreadyLoaded.length > 0 ? `Already loaded: ${result.alreadyLoaded.join(", ")}` : "",
          alreadyActive.length > 0 ? `Already active — nothing to load, call directly: ${alreadyActive.join(", ")}` : "",
          ambiguous.length > 0 ? `Ambiguous, name the server too: ${ambiguous.join("; ")}` : "",
          allUnknown.length > 0 ? unknownExplanation(allUnknown, catalog) : "",
          options.activeTools
            ? `Loaded on demand: ${result.activeToolSet.length}/${result.maxActiveTools} (the ${options.activeTools.length} tools you started with are separate and always callable)`
            : `Active tools: ${result.activeToolSet.length}/${result.maxActiveTools}`,
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
const INDEX_CHAR_BUDGET_DEFAULT = 24_000;
const INDEX_ONE_LINER_FULL = 300;
const INDEX_ONE_LINER_SHORT = 110;

type IndexTier = "full" | "short" | "names" | "header";

function indexCharBudget(): number {
  const raw = Number(process.env["XYNE_CATALOG_INDEX_BUDGET"]);
  return Number.isFinite(raw) && raw >= 2_000 ? raw : INDEX_CHAR_BUDGET_DEFAULT;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}

function renderCatalogSection(name: string, entries: ToolCatalogEntry[], tier: IndexTier): string[] {
  const header = `- **${name}** (${entries.length} tool${entries.length === 1 ? "" : "s"})`;
  if (tier === "header") return [`${header} — call search-tools with this catalog to see its tools.`];
  if (tier === "names") return [`${header}: ${entries.map((e) => e.name).join(", ")}`];
  const max = tier === "full" ? INDEX_ONE_LINER_FULL : INDEX_ONE_LINER_SHORT;
  return [header, ...entries.map((e) => `    - ${e.name}: ${clip(e.oneLineDescription, max)}`)];
}

const TIER_ORDER: IndexTier[] = ["full", "short", "names", "header"];

function fitIndexTiers(byCatalog: Array<[string, ToolCatalogEntry[]]>, budget: number): Map<string, IndexTier> {
  const tiers = new Map<string, IndexTier>(byCatalog.map(([name]) => [name, "full"]));
  const sizeAt = (name: string, entries: ToolCatalogEntry[], tier: IndexTier): number =>
    renderCatalogSection(name, entries, tier).join("\n").length + 1;
  const sizes = new Map<string, number>(byCatalog.map(([name, entries]) => [name, sizeAt(name, entries, "full")]));
  let total = [...sizes.values()].reduce((sum, n) => sum + n, 0);
  const entriesOf = new Map(byCatalog);
  while (total > budget) {
    let target: string | undefined;
    let largest = -1;
    for (const [name, size] of sizes) {
      if (tiers.get(name) !== "header" && size > largest) {
        largest = size;
        target = name;
      }
    }
    if (!target) break;
    const next = TIER_ORDER[TIER_ORDER.indexOf(tiers.get(target)!) + 1]!;
    tiers.set(target, next);
    const resized = sizeAt(target, entriesOf.get(target)!, next);
    total += resized - sizes.get(target)!;
    sizes.set(target, resized);
  }
  return tiers;
}

export function renderToolCatalogForPrompt(
  catalog: ToolCatalogEntry[],
  opts?: { subagentDelegationDisabled?: boolean; fullIndex?: boolean; preferDirect?: boolean },
): string {
  if (catalog.length === 0) return "";

  const byCatalog = new Map<string, ToolCatalogEntry[]>();
  for (const entry of catalog) {
    const list = byCatalog.get(entry.catalog) ?? [];
    list.push(entry);
    byCatalog.set(entry.catalog, list);
  }
  const ordered = [...byCatalog.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entries]): [string, ToolCatalogEntry[]] => [name, entries.slice().sort((a, b) => a.name.localeCompare(b.name))]);

  const subagentCatalogs = [...new Set(catalog.filter((e) => e.source.startsWith("subagent:") || e.source.startsWith("custom-subagent:")).map((e) => e.catalog))].sort();
  const directFirst =
    opts?.preferDirect && !opts.subagentDelegationDisabled && subagentCatalogs.length
      ? [`The ${subagentCatalogs.join(", ")} catalog${subagentCatalogs.length === 1 ? " holds" : "s hold"} the same tools your subagent${subagentCatalogs.length === 1 ? "" : "s"} of that name use${subagentCatalogs.length === 1 ? "s" : ""}, writes included. Call them yourself first: a subagent is a slow nested model run, so delegate only for open-ended research that needs many queries.`]
      : [];
  const intro = opts?.subagentDelegationDisabled
    ? "Subagent delegation is disabled. The tools below are NOT loaded yet — use `load-tools` to pull in the ones you need, then call them yourself."
    : "The tools below are NOT loaded yet — their full schemas arrive only when you ask for them.";

  if (opts?.fullIndex) {
    const tiers = fitIndexTiers(ordered, indexCharBudget());
    return [
      "## Tool Catalogs",
      intro,
      "Tools already in your tool list are ready to call — they are not listed here and never need searching or loading.",
      ...directFirst,
      "Every tool you can load is named below. Pick only the specific tools this task will call and pass their exact names to `load-tools` — no search needed. Do not load a whole catalog: each loaded tool adds its full schema to your context. Use `search-tools` only when nothing listed fits, or with `scope=\"claw\"` to look beyond this agent. Loaded tools are callable from your next turn, so request them in one call.",
      ...ordered.flatMap(([name, entries]) => renderCatalogSection(name, entries, tiers.get(name)!)),
    ].join("\n");
  }

  const sections = ordered.flatMap(([name, sorted]) => {
    const header = `- **${name}** (${sorted.length} tool${sorted.length === 1 ? "" : "s"})`;
    if (sorted.length > INLINE_LISTING_MAX) {
      return [`${header} — call search-tools with this catalog to see its tools.`];
    }
    return [header, ...sorted.map((entry) => `    - ${entry.name}: ${entry.oneLineDescription}`)];
  });

  return [
    "## Tool Catalogs",
    intro,
    ...directFirst,
    "Call `search-tools` to find one — no arguments lists everything here, a `query` narrows it, and `scope=\"claw\"` looks beyond this agent at every tool the deployment has. Then `load-tools` activates the ones you need. Loaded tools are callable from your next turn, so batch everything into one call.",
    ...sections,
  ].join("\n");
}
