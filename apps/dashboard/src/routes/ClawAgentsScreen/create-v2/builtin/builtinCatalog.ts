import type {
  AvailableTools,
  IntegrationToolEntry,
  ToolboxSelection,
} from '@/services/claw/clawToolsTypes';

export type BuiltinSelection = Required<ToolboxSelection>;

export type BuiltinRisk = 'read' | 'write' | 'destructive';

export interface BuiltinCatalogEntry {
  source: string;
  label: string;
  tools: IntegrationToolEntry[];
  usageCount: number;
  risk: BuiltinRisk;
}

const RISK_RANK: Record<BuiltinRisk, number> = { read: 0, write: 1, destructive: 2 };

function humanizeSource(source: string): string {
  return source
    .replace(/^custom:/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

export function buildBuiltinCatalog(availableTools: AvailableTools | null): BuiltinCatalogEntry[] {
  if (!availableTools) return [];

  const integrationBySlug = new Map(
    availableTools.integrations.map(integration => [integration.slug, integration]),
  );

  return availableTools.customGroups
    .map(group => {
      const integration = integrationBySlug.get(group.source);
      const entries = integration
        ? [...integration.readTools, ...integration.writeTools]
        : group.tools.map(tool => ({
            slug: tool.slug,
            name: tool.name,
            description: '',
            riskLevel: 'read' as const,
          }));

      let risk: BuiltinRisk = 'read';
      for (const tool of entries) {
        if (RISK_RANK[tool.riskLevel] > RISK_RANK[risk]) risk = tool.riskLevel;
      }

      return {
        source: group.source,
        label: integration?.label || humanizeSource(group.source),
        tools: entries,
        usageCount: integration?.usageCount ?? 0,
        risk,
      };
    })
    .filter(entry => entry.tools.length > 0);
}

export function isToolSelected(selection: ToolboxSelection, tool: IntegrationToolEntry): boolean {
  return selection.custom.includes(tool.slug);
}

export function selectedTools(
  selection: ToolboxSelection,
  entry: BuiltinCatalogEntry,
): IntegrationToolEntry[] {
  return entry.tools.filter(tool => isToolSelected(selection, tool));
}

export function isEntryEnabled(selection: ToolboxSelection, entry: BuiltinCatalogEntry): boolean {
  return entry.tools.some(tool => isToolSelected(selection, tool));
}

function normalize(selection: ToolboxSelection): BuiltinSelection {
  return {
    subagents: selection.subagents,
    direct: selection.direct,
    custom: selection.custom,
    gateway: selection.gateway ?? [],
  };
}

export function setToolsSelected(
  selection: ToolboxSelection,
  tools: readonly IntegrationToolEntry[],
  next: boolean,
): BuiltinSelection {
  const base = normalize(selection);
  if (tools.length === 0) return base;
  const touched = new Set(tools.map(tool => tool.slug));
  const rest = base.custom.filter(slug => !touched.has(slug));
  return { ...base, custom: next ? [...rest, ...touched] : rest };
}

export function enableEntry(
  selection: ToolboxSelection,
  entry: BuiltinCatalogEntry,
  tools?: readonly IntegrationToolEntry[],
): BuiltinSelection {
  return setToolsSelected(selection, tools && tools.length > 0 ? tools : entry.tools, true);
}

export function disableEntry(
  selection: ToolboxSelection,
  entry: BuiltinCatalogEntry,
): BuiltinSelection {
  return setToolsSelected(selection, entry.tools, false);
}
