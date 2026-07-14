// Bridges the subagent tool contract (`SubagentTools` = { direct, custom }) with
// the shared ToolboxPicker's richer `ToolboxSelection` shape, so the subagent
// wizard/edit screens can reuse the agent's full toolbox UI without changing the
// subagent backend contract.
//
// Subagent semantics we preserve on save:
//   - direct  → built-in "write" tools, keyed by tool NAME
//   - custom  → MCP server tools + built-in group tools, keyed by tool SLUG
//
// ToolboxPicker semantics we translate from/to:
//   - direct  → write-tool names + non-gateway MCP tool NAMES + gateway tool SLUGS
//   - custom  → built-in group SLUGS
//   - gateway → gateway service names (bulk selection)
//   - subagents → subagent names (not persisted by the subagent backend)
import { parseGatewaySource } from '@/components/ClawAgents/gatewayKeys';
import type { AvailableTools, ToolboxSelection } from './clawToolsTypes';
import type { SubagentTools } from './clawSubagentsTypes';

interface ToolIndex {
  /** Built-in "direct" tools, keyed by name. */
  writeToolNames: Set<string>;
  /** Non-gateway MCP tools. */
  mcpNameToSlug: Map<string, string>;
  mcpSlugToName: Map<string, string>;
  /** Gateway MCP tool slugs (selection key for gateway tools is the slug). */
  gatewaySlugs: Set<string>;
  /** Gateway service name → its tool slugs (for expanding bulk gateway selections). */
  gatewayServiceToSlugs: Map<string, string[]>;
  /** Built-in group tool slugs. */
  builtinSlugs: Set<string>;
}

const dedupe = (values: string[]): string[] => [...new Set(values)];

const buildIndex = (catalog: AvailableTools | null): ToolIndex => {
  const idx: ToolIndex = {
    writeToolNames: new Set(),
    mcpNameToSlug: new Map(),
    mcpSlugToName: new Map(),
    gatewaySlugs: new Set(),
    gatewayServiceToSlugs: new Map(),
    builtinSlugs: new Set(),
  };
  if (!catalog) return idx;

  for (const tool of catalog.writeTools) idx.writeToolNames.add(tool.name);

  for (const [source, tools] of Object.entries(catalog.serverTools)) {
    const gateway = parseGatewaySource(source);
    if (gateway) {
      const slugs = idx.gatewayServiceToSlugs.get(gateway.serviceName) ?? [];
      for (const tool of tools) {
        idx.gatewaySlugs.add(tool.slug);
        slugs.push(tool.slug);
      }
      idx.gatewayServiceToSlugs.set(gateway.serviceName, slugs);
    } else {
      for (const tool of tools) {
        idx.mcpNameToSlug.set(tool.name, tool.slug);
        idx.mcpSlugToName.set(tool.slug, tool.name);
      }
    }
  }

  for (const group of catalog.customGroups)
    for (const tool of group.tools) idx.builtinSlugs.add(tool.slug);

  return idx;
};

/** Seed a ToolboxPicker selection from a subagent's persisted tools. */
export const toToolboxSelection = (
  tools: SubagentTools | undefined,
  catalog: AvailableTools | null,
): ToolboxSelection => {
  const idx = buildIndex(catalog);
  const direct: string[] = [];
  const custom: string[] = [];

  // Subagent `direct` are write-tool names — same key the picker uses.
  for (const name of tools?.direct ?? []) direct.push(name);

  // Subagent `custom` are slugs: split built-ins vs MCP (which the picker
  // surfaces under `direct`). Unknown slugs are preserved as-is under custom.
  for (const slug of tools?.custom ?? []) {
    if (idx.builtinSlugs.has(slug)) custom.push(slug);
    else if (idx.mcpSlugToName.has(slug)) direct.push(idx.mcpSlugToName.get(slug)!);
    else if (idx.gatewaySlugs.has(slug)) direct.push(slug);
    else custom.push(slug);
  }

  return { subagents: [], direct: dedupe(direct), custom: dedupe(custom), gateway: [] };
};

/** Flatten a ToolboxPicker selection back into the subagent tool contract. */
export const fromToolboxSelection = (
  selection: ToolboxSelection,
  catalog: AvailableTools | null,
): SubagentTools => {
  const idx = buildIndex(catalog);
  const direct: string[] = [];
  const custom: string[] = [];

  for (const key of selection.direct) {
    if (idx.writeToolNames.has(key)) direct.push(key);
    else if (idx.mcpNameToSlug.has(key)) custom.push(idx.mcpNameToSlug.get(key)!);
    else if (idx.gatewaySlugs.has(key)) custom.push(key);
    else direct.push(key); // unknown/typed direct tool — preserve
  }

  // Built-in group slugs (and any unknown slugs preserved on load).
  for (const slug of selection.custom) custom.push(slug);

  // Bulk gateway service selections expand to their tool slugs.
  for (const service of selection.gateway ?? [])
    for (const slug of idx.gatewayServiceToSlugs.get(service) ?? []) custom.push(slug);

  const out: SubagentTools = {};
  const directTools = dedupe(direct);
  const customTools = dedupe(custom);
  if (directTools.length) out.direct = directTools;
  if (customTools.length) out.custom = customTools;
  return out;
};
