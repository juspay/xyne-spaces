import type { SubagentDef, SubagentSource } from '@/services/claw/clawSubagentsTypes';
import type { AvailableTools, ToolboxSelection } from '@/services/claw/clawToolsTypes';

export type SubagentSelection = Required<ToolboxSelection>;

export type SubagentRisk = 'read' | 'write' | 'destructive';

export interface SubagentCatalogEntry {
  name: string;
  description: string;
  source: SubagentSource;
  serverType: string;
  progressLabel: string;
  def: SubagentDef | undefined;
  risk: SubagentRisk;
  toolCount: number;
  skillCount: number;
}

const RISK_RANK: Record<SubagentRisk, number> = { read: 0, write: 1, destructive: 2 };

const DEFAULT_RISK: SubagentRisk = 'read';

interface IntegrationFacts {
  risk: SubagentRisk | undefined;
  toolCount: number;
}

function buildIntegrationFacts(
  availableTools: AvailableTools | null,
): Map<string, IntegrationFacts> {
  const facts = new Map<string, IntegrationFacts>();
  if (!availableTools) return facts;
  for (const integration of availableTools.integrations) {
    const tools = [...integration.readTools, ...integration.writeTools];
    let risk: SubagentRisk | undefined;
    for (const tool of tools) {
      if (!risk || RISK_RANK[tool.riskLevel] > RISK_RANK[risk]) risk = tool.riskLevel;
    }
    facts.set(integration.slug, { risk, toolCount: tools.length });
  }
  return facts;
}

export function buildSubagentCatalog(
  availableTools: AvailableTools | null,
  definitions: readonly SubagentDef[],
): SubagentCatalogEntry[] {
  if (!availableTools) return [];
  const defByName = new Map(definitions.map(def => [def.name, def]));
  const factsBySlug = buildIntegrationFacts(availableTools);

  return availableTools.subagents.map(subagent => {
    const def = defByName.get(subagent.name);
    const facts = factsBySlug.get(subagent.serverType);
    return {
      name: subagent.name,
      description: def?.description || subagent.description,
      source:
        def?.source ?? (subagent.serverType.startsWith('custom-defined:') ? 'custom' : 'builtin'),
      serverType: subagent.serverType,
      progressLabel: subagent.progressLabel,
      def,
      risk: facts?.risk ?? DEFAULT_RISK,
      toolCount: facts?.toolCount ?? 0,
      skillCount: def?.skills.length ?? 0,
    };
  });
}

export function isSubagentSelected(
  selection: ToolboxSelection,
  entry: SubagentCatalogEntry,
): boolean {
  return selection.subagents.includes(entry.name);
}

function normalize(selection: ToolboxSelection): SubagentSelection {
  return {
    subagents: selection.subagents,
    direct: selection.direct,
    custom: selection.custom,
    gateway: selection.gateway ?? [],
  };
}

export function enableSubagent(
  selection: ToolboxSelection,
  entry: SubagentCatalogEntry,
): SubagentSelection {
  const base = normalize(selection);
  if (base.subagents.includes(entry.name)) return base;
  return { ...base, subagents: [...base.subagents, entry.name] };
}

export function disableSubagent(
  selection: ToolboxSelection,
  entry: SubagentCatalogEntry,
): SubagentSelection {
  const base = normalize(selection);
  return { ...base, subagents: base.subagents.filter(name => name !== entry.name) };
}

export function toggleSubagent(
  selection: ToolboxSelection,
  entry: SubagentCatalogEntry,
): SubagentSelection {
  return isSubagentSelected(selection, entry)
    ? disableSubagent(selection, entry)
    : enableSubagent(selection, entry);
}
