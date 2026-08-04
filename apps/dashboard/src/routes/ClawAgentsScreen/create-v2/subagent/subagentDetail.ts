import type { SubagentDef } from '@/services/claw/clawSubagentsTypes';
import type { AvailableTools, Integration } from '@/services/claw/clawToolsTypes';

export interface McpRef {
  slug: string;
  label: string;
}

export interface ToolRef {
  key: string;
  label: string;
}

export interface SubagentCapabilities {
  mcps: McpRef[];
  builtinTools: ToolRef[];
  systemTools: ToolRef[];
}

const EMPTY: SubagentCapabilities = { mcps: [], builtinTools: [], systemTools: [] };

function integrationByToolName(availableTools: AvailableTools): Map<string, Integration> {
  const owners = new Map<string, Integration>();
  for (const integration of availableTools.integrations) {
    for (const tool of [...integration.readTools, ...integration.writeTools]) {
      if (!owners.has(tool.name)) owners.set(tool.name, integration);
    }
  }
  return owners;
}

function systemToolNames(availableTools: AvailableTools): Map<string, string> {
  const names = new Map<string, string>();
  for (const group of availableTools.customGroups) {
    for (const tool of group.tools) names.set(tool.slug, tool.name);
  }
  return names;
}

export function resolveSubagentCapabilities(
  availableTools: AvailableTools | null,
  def: SubagentDef | undefined,
  serverType: string,
): SubagentCapabilities {
  if (!def) return EMPTY;

  const directNames = def.tools?.direct ?? [];
  const customSlugs = def.tools?.custom ?? [];

  if (!availableTools) {
    return {
      mcps: [],
      builtinTools: directNames.map(name => ({ key: name, label: name })),
      systemTools: customSlugs.map(slug => ({ key: slug, label: slug })),
    };
  }

  const owners = integrationByToolName(availableTools);
  const mcps = new Map<string, McpRef>();

  for (const name of directNames) {
    const owner = owners.get(name);
    if (owner && !mcps.has(owner.slug)) {
      mcps.set(owner.slug, { slug: owner.slug, label: owner.label });
    }
  }

  if (mcps.size === 0 && serverType) {
    const owner = availableTools.integrations.find(item => item.slug === serverType);
    if (owner) mcps.set(owner.slug, { slug: owner.slug, label: owner.label });
  }

  const names = systemToolNames(availableTools);

  return {
    mcps: [...mcps.values()],
    builtinTools: directNames.map(name => ({ key: name, label: name })),
    systemTools: customSlugs.map(slug => ({ key: slug, label: names.get(slug) ?? slug })),
  };
}
