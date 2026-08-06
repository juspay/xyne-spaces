import type { AvailableTools, ToolboxSelection } from '@/services/claw/clawToolsTypes';

export type SubagentToolKind = 'write' | 'server' | 'system';

export interface SubagentToolEntry {
  key: string;
  name: string;
  source: string;
}

export interface SubagentToolGroup {
  source: string;
  tools: SubagentToolEntry[];
}

export interface SubagentToolSectionData {
  kind: SubagentToolKind;
  title: string;
  caption: string;
  groups: SubagentToolGroup[];
  total: number;
}

export type SubagentSelection = Required<ToolboxSelection>;

export function normalizeSelection(selection: ToolboxSelection): SubagentSelection {
  return {
    subagents: selection.subagents,
    direct: selection.direct,
    custom: selection.custom,
    gateway: selection.gateway ?? [],
  };
}

function group(tools: SubagentToolEntry[]): SubagentToolGroup[] {
  const bySource = new Map<string, SubagentToolEntry[]>();
  for (const tool of tools) {
    const list = bySource.get(tool.source);
    if (list) list.push(tool);
    else bySource.set(tool.source, [tool]);
  }
  return [...bySource.entries()]
    .map(([source, entries]) => ({ source, tools: entries }))
    .filter(entry => entry.tools.length > 0);
}

export function buildSubagentToolSections(
  availableTools: AvailableTools | null,
): SubagentToolSectionData[] {
  if (!availableTools) return [];

  const writeNames = new Set(availableTools.writeTools.map(tool => tool.name));

  const write: SubagentToolEntry[] = availableTools.writeTools.map(tool => ({
    key: tool.name,
    name: tool.name,
    source: tool.source,
  }));

  // A name already listed as a write tool is skipped here so each tool shows
  // up in exactly one section.
  const server: SubagentToolEntry[] = Object.entries(availableTools.serverTools ?? {}).flatMap(
    ([source, tools]) =>
      tools
        .filter(tool => !writeNames.has(tool.name))
        .map(tool => ({ key: tool.name, name: tool.name, source })),
  );

  const system: SubagentToolEntry[] = availableTools.customGroups.flatMap(entry =>
    entry.tools.map(tool => ({ key: tool.slug, name: tool.name, source: entry.source })),
  );

  const sections: SubagentToolSectionData[] = [
    {
      kind: 'write',
      title: 'Write Tools',
      caption: 'Actions that change something. Selected by name.',
      groups: group(write),
      total: write.length,
    },
    {
      kind: 'server',
      title: 'MCP',
      caption: 'Tools exposed by connected MCP servers.',
      groups: group(server),
      total: server.length,
    },
    {
      kind: 'system',
      title: 'System Tools',
      caption: 'Platform tool groups registered for this workspace.',
      groups: group(system),
      total: system.length,
    },
  ];

  return sections.filter(section => section.total > 0);
}

/** Which selection bucket a section writes into. */
function bucketOf(kind: SubagentToolKind): 'direct' | 'custom' {
  return kind === 'system' ? 'custom' : 'direct';
}

export function isToolSelected(
  selection: ToolboxSelection,
  kind: SubagentToolKind,
  tool: SubagentToolEntry,
): boolean {
  return normalizeSelection(selection)[bucketOf(kind)].includes(tool.key);
}

export function setToolsSelected(
  selection: ToolboxSelection,
  kind: SubagentToolKind,
  tools: readonly SubagentToolEntry[],
  next: boolean,
): SubagentSelection {
  const base = normalizeSelection(selection);
  const bucket = bucketOf(kind);
  const keys = new Set(tools.map(tool => tool.key));
  const remaining = base[bucket].filter(key => !keys.has(key));
  return { ...base, [bucket]: next ? [...remaining, ...keys] : remaining };
}

export function selectedIn(
  selection: ToolboxSelection,
  section: SubagentToolSectionData,
): SubagentToolEntry[] {
  const chosen = new Set(normalizeSelection(selection)[bucketOf(section.kind)]);
  return section.groups.flatMap(entry => entry.tools.filter(tool => chosen.has(tool.key)));
}

export function humanizeSource(source: string): string {
  const bare = source.replace(/^custom:/, '').replace(/^mcp:/, '');
  return bare.replace(/[-_]/g, ' ').replace(/^[a-z]/, char => char.toUpperCase());
}

export function selectedInGroup(
  selection: ToolboxSelection,
  kind: SubagentToolKind,
  group: SubagentToolGroup,
): SubagentToolEntry[] {
  const chosen = new Set(normalizeSelection(selection)[bucketOf(kind)]);
  return group.tools.filter(tool => chosen.has(tool.key));
}

export function isGroupEnabled(
  selection: ToolboxSelection,
  kind: SubagentToolKind,
  group: SubagentToolGroup,
): boolean {
  return selectedInGroup(selection, kind, group).length > 0;
}
