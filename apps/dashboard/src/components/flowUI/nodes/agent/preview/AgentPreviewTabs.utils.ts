import type { AgentIdentity } from '@xyne/shared';
import type { DetailListItem } from '../../../../../routes/AIScreen/library/shared/primitives/DetailListCard';
import { humanizeToolName } from '../../../../../routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';

type Capability = NonNullable<AgentIdentity['capabilities']>[number];

export function providerLine(agent: AgentIdentity): string {
  const order = agent.providerOrder ?? [];
  return order.length > 0 ? order.join(' → ') : 'Spaces default';
}

export function connectedProviderCount(agent: AgentIdentity): string {
  const providers = agent.providers ?? [];
  return `${providers.filter(provider => provider.connected).length} of ${providers.length} connected`;
}

export type ToolGroup = 'subagent' | 'agent' | 'mcp' | 'builtin';

export const TOOL_SECTIONS: { group: ToolGroup; label: string; info: string; empty: string }[] = [
  {
    group: 'subagent',
    label: 'Subagents',
    info: 'Specialist agents this agent can hand work to',
    empty: 'No subagents added yet.',
  },
  {
    group: 'agent',
    label: 'Agents',
    info: 'Other agents this one can call directly',
    empty: 'No agents added yet.',
  },
  {
    group: 'mcp',
    label: 'MCP Tools',
    info: 'Connected integrations it can act through',
    empty: 'No MCPs added yet.',
  },
  {
    group: 'builtin',
    label: 'Built-In tools',
    info: 'Capabilities that ship with the platform',
    empty: 'No built-in tools added yet.',
  },
];

export function capabilityGroup(capability: Capability): ToolGroup {
  return capability.group ?? (capability.kind === 'subagent' ? 'subagent' : 'builtin');
}

export interface ToolListItem extends DetailListItem {
  ids: string[];
}

function capabilityDescription(capability: Capability): string {
  if (capability.description) {
    return capability.description;
  }
  return capability.requiresConnection ? `Needs ${capability.requiresConnection} connected` : '';
}

function toolCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'tool' : 'tools'}`;
}

export function toolItemsForGroup(capabilities: Capability[], group: ToolGroup): ToolListItem[] {
  const items: ToolListItem[] = [];
  const grouped = new Map<string, { item: ToolListItem; labels: string[] }>();

  for (const capability of capabilities) {
    if (capabilityGroup(capability) !== group) {
      continue;
    }

    const parentId = capability.parentId;
    if (!parentId) {
      items.push({
        key: capability.id,
        ids: [capability.id],
        name: capability.label,
        description: capabilityDescription(capability),
        iconType: capability.iconKey ?? '',
      });
      continue;
    }

    const entry = grouped.get(parentId);
    if (entry) {
      entry.item.ids.push(capability.id);
      entry.labels.push(humanizeToolName(capability.label));
      continue;
    }

    const item: ToolListItem = {
      key: parentId,
      ids: [capability.id],
      name: capability.parentLabel ?? parentId,
      description: '',
      iconType: capability.iconKey ?? '',
    };
    grouped.set(parentId, { item, labels: [humanizeToolName(capability.label)] });
    items.push(item);
  }

  for (const { item, labels } of grouped.values()) {
    item.description = labels.join(', ');
    item.meta = toolCountLabel(item.ids.length);
  }

  return items;
}

export function skillItems(agent: AgentIdentity): DetailListItem[] {
  return (agent.skills ?? []).map(skill => ({
    key: skill.id,
    name: skill.name,
    description: skill.description ?? '',
  }));
}

export function knowledgeItems(agent: AgentIdentity): DetailListItem[] {
  return (agent.knowledge?.sources ?? []).map(source => ({
    key: source.id,
    name: source.name,
    description: source.kind === 'file' ? 'File' : 'Collection',
  }));
}

export function appliesToLabel(agent: AgentIdentity): string {
  return agent.knowledge?.scope === 'USER' ? "Each user's own access" : 'The collections below';
}
