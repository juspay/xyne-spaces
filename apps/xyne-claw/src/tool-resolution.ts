/**
 * tool-resolution.ts — THE single derivation of an agent's effective toolset.
 *
 * Before this module, membership was derived twice (buildSubagentTools for
 * normal mode; buildFastModeDirectTools + buildToolCatalog for fast mode) and
 * authorized three times (run.ts main filter, run.ts nested-A2A filter, and
 * catalog-source checks embedded in the main filter) — with real divergence:
 * definition-less servers (github-mcp-npx) were invisible to the fast catalog
 * while passing through normal mode, and the nested filter's fallthrough was
 * permissive where the main one was per-source.
 *
 * This module resolves ONCE — wrap → classify writes → authorize, recording a
 * reason for every exclusion — and the two modes become PRESENTATIONS of the
 * same resolved set (see presentAsFastCatalog / the run.ts wiring). Invariant,
 * enforced by test/tool-resolution.test.ts: fast mode's (catalog ∪ direct)
 * name-set equals normal mode's effective membership for identical input.
 *
 * Diagnostics are first-class: a server that failed to list stays in
 * `servers[]` with its error, and report() renders one line per server so a
 * run's log (and search-tools misses) can say "github failed to load: X"
 * instead of handing the model an absence it will confabulate a cause for.
 */
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  findSubagentDefinitionForServer,
  type AgentToolsConfig,
  type SubagentDefinition,
} from "xyne-claw-shared";
import type { McpToolGroup } from "./mcp.js";

/** A listed (or failed) tool server, wrapper-resolved. */
export interface ResolvedServer {
  serverType: string;
  serverName: string;
  /** Definition wrapping this server (alias-aware) — null for def-less servers,
   *  which remain first-class under the pseudo-source `server:<type>`. */
  wrapper: SubagentDefinition | null;
  tools: ToolDefinition[];
  writeTools: ReadonlySet<string>;
  /** Listing failure — server is kept visible so absence ≠ silence. */
  error?: string;
}

export type ToolVerdict =
  | { allowed: true; reason: string }
  | { allowed: false; reason: string };

export interface ResolvedTool {
  tool: ToolDefinition;
  server: ResolvedServer;
  /** Catalog/source label: `subagent:<wrapper>` or `server:<type>`. */
  source: string;
  isWrite: boolean;
  verdict: ToolVerdict;
}

export interface ToolResolution {
  servers: ResolvedServer[];
  tools: ResolvedTool[];
  allowed: ResolvedTool[];
  /** One line per server: counts, verdicts, and load errors. */
  report(): string;
  /** Human hints for servers that contributed nothing — failed or fully denied.
   *  Surfaced on search-tools misses so agents report facts, not theories. */
  missingServerHints(): string[];
}

export interface ResolveToolsInput {
  groups: McpToolGroup[];
  /** Servers that failed to list — carried through as error entries. */
  failedGroups?: Array<{ serverType: string; serverName: string; error: string }>;
  toolsConfig?: AgentToolsConfig | undefined;
}

function extractRuntimeToolName(name: string): string {
  const idx = name.lastIndexOf("__");
  return idx >= 0 ? name.slice(idx + 2) : name;
}

/**
 * The direct-pick name matching, ported VERBATIM from run.ts selectedAsDirect
 * (five conventions — bare, suffix, prefixed-config, normalized, selectionKey).
 * Load-bearing for existing agent configs; do not "simplify".
 */
export function matchesDirectPick(tool: ToolDefinition, allowedDirect: readonly string[]): boolean {
  const norm = (s: string): string => s.toLowerCase().replace(/_/g, "-");
  const toolSelectionKey = (tool as { selectionKey?: string }).selectionKey;
  return allowedDirect.some(
    (d) =>
      tool.name === d ||
      tool.name.endsWith(d) ||
      d.endsWith(`__${tool.name}`) ||
      norm(tool.name) === norm(d) ||
      (toolSelectionKey ? d === toolSelectionKey : false),
  );
}

/**
 * Authorization for one tool. Grant units, in precedence order:
 *  - no toolsConfig at all → everything allowed (backwards compatible);
 *  - wrapper servers: allowed iff `tools.subagents` names the wrapper;
 *  - def-less servers: allowed iff `tools.subagents` names the serverType
 *    (its coherent grant unit — fixes the old fast-mode path where these
 *    tools were dumped into directTools and killed by the name-gate),
 *    OR the individual tool is direct/custom/gateway-picked;
 *  - individual picks (direct 5-way match, custom selectionKey, gateway
 *    serviceName) admit a tool regardless of wrapper grant, matching the
 *    main filter's historical directTools branch.
 */
function authorize(
  tool: ToolDefinition,
  server: ResolvedServer,
  cfg: AgentToolsConfig | undefined,
): ToolVerdict {
  if (!cfg) return { allowed: true, reason: "no tools config (all tools)" };
  const subagents = new Set(cfg.subagents ?? []);
  const custom = new Set(cfg.custom ?? []);
  const gateway = new Set(cfg.gateway ?? []);

  const grantUnit = server.wrapper?.name ?? server.serverType;
  if (subagents.has(grantUnit)) {
    return { allowed: true, reason: `subagent grant "${grantUnit}"` };
  }
  if (matchesDirectPick(tool, cfg.direct ?? [])) {
    return { allowed: true, reason: "direct pick" };
  }
  const selectionKey = (tool as { selectionKey?: string }).selectionKey;
  if (selectionKey && custom.has(selectionKey)) {
    return { allowed: true, reason: `custom pick "${selectionKey}"` };
  }
  const serviceName = (tool as { serviceName?: string }).serviceName;
  if (serviceName && gateway.has(serviceName)) {
    return { allowed: true, reason: `gateway grant "${serviceName}"` };
  }
  return {
    allowed: false,
    reason: `not granted (needs tools.subagents:"${grantUnit}" or a direct/custom/gateway pick)`,
  };
}

export function resolveTools(input: ResolveToolsInput): ToolResolution {
  const servers: ResolvedServer[] = [];
  const tools: ResolvedTool[] = [];

  for (const group of input.groups) {
    const wrapper = findSubagentDefinitionForServer(group.serverType) ?? null;
    const server: ResolvedServer = {
      serverType: group.serverType,
      serverName: group.serverName,
      wrapper,
      tools: group.tools,
      writeTools: new Set(group.writeTools.map(String)),
    };
    servers.push(server);
    const source = wrapper ? `subagent:${wrapper.name}` : `server:${group.serverType}`;
    for (const tool of group.tools) {
      tools.push({
        tool,
        server,
        source,
        isWrite: server.writeTools.has(extractRuntimeToolName(tool.name)),
        verdict: authorize(tool, server, input.toolsConfig),
      });
    }
  }

  for (const failed of input.failedGroups ?? []) {
    servers.push({
      serverType: failed.serverType,
      serverName: failed.serverName,
      wrapper: findSubagentDefinitionForServer(failed.serverType) ?? null,
      tools: [],
      writeTools: new Set(),
      error: failed.error,
    });
  }

  const allowed = tools.filter((t) => t.verdict.allowed);

  const report = (): string =>
    servers
      .map((s) => {
        if (s.error) return `${s.serverType}: FAILED to list (${s.error})`;
        const mine = tools.filter((t) => t.server === s);
        const ok = mine.filter((t) => t.verdict.allowed);
        const denied = mine.length - ok.length;
        const writes = ok.filter((t) => t.isWrite).length;
        const via = s.wrapper ? `subagent:${s.wrapper.name}` : "def-less";
        return `${s.serverType} (${via}): ${mine.length} tools, ${ok.length} allowed (${writes} write)${denied ? `, ${denied} denied: ${mine.find((t) => !t.verdict.allowed)?.verdict.reason}` : ""}`;
      })
      .join("\n");

  const missingServerHints = (): string[] => {
    const hints: string[] = [];
    for (const s of servers) {
      if (s.error) {
        hints.push(`Server "${s.serverType}" failed to load its tools: ${s.error}`);
        continue;
      }
      const mine = tools.filter((t) => t.server === s);
      if (mine.length > 0 && mine.every((t) => !t.verdict.allowed)) {
        hints.push(
          `Server "${s.serverType}" is connected but excluded by this agent's tools config (${mine[0]?.verdict.reason}).`,
        );
      }
    }
    return hints;
  };

  return { servers, tools, allowed, report, missingServerHints };
}

// ── Fast-mode presentation ──────────────────────────────────────────────────

export interface FastPresentation {
  /** Always-active: allowed write tools (a human approves writes elsewhere in
   *  the flow — burying them behind load-tools would only add latency). */
  directTools: ResolvedTool[];
  /** Lazy catalog: allowed read tools, loadable via search-tools/load-tools. */
  catalogTools: ResolvedTool[];
}

/** Fast mode = same membership, lazy presentation. Writes direct, reads lazy. */
export function presentAsFastCatalog(resolution: ToolResolution): FastPresentation {
  const directTools: ResolvedTool[] = [];
  const catalogTools: ResolvedTool[] = [];
  for (const t of resolution.allowed) {
    (t.isWrite ? directTools : catalogTools).push(t);
  }
  return { directTools, catalogTools };
}
