import type { AvailableTools, Integration } from '@/src/services/claw/clawToolsTypes';
import { findIntegrationForServerType, type SubagentRiskLevel } from '@/src/utils/subagentRisk';

export type BuiltinBrowseTool = {
  id: string;
  name: string;
  description: string;
  risk: SubagentRiskLevel;
};

export type BuiltinBrowseItem = {
  id: string;
  name: string;
  ids: string[];
  tools: BuiltinBrowseTool[];
  risk: SubagentRiskLevel;
};

export type BuiltinBrowseFilter = 'all' | SubagentRiskLevel;

export const BUILTIN_FILTER_OPTIONS: Array<{ id: BuiltinBrowseFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'read', label: 'Read only' },
  { id: 'write', label: 'Write' },
  { id: 'destructive', label: 'Destructive' },
];

const RISK_RANK: Record<SubagentRiskLevel, number> = {
  read: 0,
  write: 1,
  destructive: 2,
};

const humanize = (value: string): string =>
  value
    .replace(/^custom:/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

const highestRisk = (levels: SubagentRiskLevel[]): SubagentRiskLevel => {
  let highest: SubagentRiskLevel = 'read';
  for (const level of levels) {
    if (RISK_RANK[level] > RISK_RANK[highest]) highest = level;
  }
  return highest;
};

const catalogToolsFor = (integration: Integration | undefined): Integration['readTools'] => [
  ...(integration?.readTools ?? []),
  ...(integration?.writeTools ?? []),
];

const findGroupIntegration = (
  source: string,
  integrations: Integration[] | undefined,
): Integration | undefined => {
  const stripped = source.replace(/^custom:/, '');
  return (
    findIntegrationForServerType(stripped, integrations) ??
    findIntegrationForServerType(source, integrations) ??
    integrations?.find(
      entry =>
        (entry.kind === 'builtin' || entry.kind === 'custom') &&
        (entry.slug === source || entry.slug === stripped),
    )
  );
};

const toBrowseItem = (
  source: string,
  name: string,
  tools: Array<{ slug: string; name: string }>,
  integration: Integration | undefined,
): BuiltinBrowseItem => {
  const catalog = catalogToolsFor(integration);
  const mapped = tools.map(tool => {
    const info = catalog.find(
      entry => entry.slug === tool.slug || entry.name === tool.name || entry.name === tool.slug,
    );
    return {
      id: tool.slug,
      name: humanize(tool.name || tool.slug),
      description: info?.description ?? '',
      risk: info?.riskLevel ?? 'read',
    } satisfies BuiltinBrowseTool;
  });
  return {
    id: source,
    name: integration?.label || name,
    ids: mapped.map(tool => tool.id),
    tools: mapped,
    risk: highestRisk(mapped.map(tool => tool.risk)),
  };
};

export const buildBuiltinBrowseItems = (
  groups: AvailableTools['customGroups'] | undefined,
  integrations: Integration[] | undefined,
): BuiltinBrowseItem[] => {
  if ((groups ?? []).length > 0) {
    return (groups ?? [])
      .map(group =>
        toBrowseItem(
          group.source,
          humanize(group.source),
          group.tools,
          findGroupIntegration(group.source, integrations),
        ),
      )
      .filter(item => item.tools.length > 0)
      .sort((left, right) => left.name.localeCompare(right.name));
  }

  return (integrations ?? [])
    .filter(entry => entry.kind === 'builtin' || entry.kind === 'custom')
    .map(entry => toBrowseItem(entry.slug, entry.label, catalogToolsFor(entry), entry))
    .filter(item => item.tools.length > 0)
    .sort((left, right) => left.name.localeCompare(right.name));
};

export const builtinCountLabel = (selectedCount: number, total: number): string => {
  if (selectedCount > 0) return `${selectedCount} of ${total} tools selected`;
  return total === 1 ? '1 tool available' : `${total} tools available`;
};

export const builtinInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export const builtinMainSubtitle = (item: BuiltinBrowseItem, selectedIds: string[]): string => {
  const selected = item.tools.filter(tool => selectedIds.includes(tool.id));
  return (selected[0] ?? item.tools[0])?.name || item.name;
};

export const builtinToolCountLabel = (count: number): string =>
  count === 1 ? '1 tool' : `${count} tools`;
