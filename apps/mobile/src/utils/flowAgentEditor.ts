export const AGENT_EDITS_STATE_KEY = 'agent-edits';
export const PLATFORM_DEFAULT_MODEL = '';

export const HOSTED_PROVIDERS = [
  'codex',
  'claude',
  'copilot',
  'openrouter',
  'litellm',
  'spaces',
] as const;

export const PROVIDER_DISPLAY: Record<string, string> = {
  spaces: 'Spaces',
  copilot: 'GitHub Copilot',
  claude: 'Anthropic Claude',
  codex: 'OpenAI Codex',
  openrouter: 'OpenRouter',
  litellm: 'LiteLLM (own key)',
};

export type AgentToolboxSelection = {
  subagents: string[];
  direct: string[];
  custom: string[];
  gateway: string[];
  callableAgents: string[];
};

export type AgentDraftEdits = {
  toolSelection: AgentToolboxSelection;
  modelId: string;
  providerOrder: string[];
};

export type AgentModelOption = {
  value: string;
  label: string;
};

export type AgentCapabilityGroup = 'subagent' | 'agent' | 'mcp' | 'builtin';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.map(String).filter(Boolean) : [];

export const emptyToolSelection = (): AgentToolboxSelection => ({
  subagents: [],
  direct: [],
  custom: [],
  gateway: [],
  callableAgents: [],
});

export const parseToolSelection = (value: unknown): AgentToolboxSelection | null => {
  if (value === undefined) return null;
  const stored = isRecord(value) ? value : {};
  return {
    subagents: stringList(stored['subagents']),
    direct: stringList(stored['direct']),
    custom: stringList(stored['custom']),
    gateway: stringList(stored['gateway']),
    callableAgents: stringList(stored['callableAgents']),
  };
};

export const isDraftAgentEditable = (input: {
  phase?: string;
  submitting?: boolean;
  toolSelection: unknown;
}): boolean => input.phase === 'pending' && !input.submitting && input.toolSelection !== undefined;

export const flattenToolSelection = (selection: AgentToolboxSelection): string[] => [
  ...selection.subagents,
  ...selection.direct,
  ...selection.custom,
  ...selection.gateway,
  ...selection.callableAgents,
];

export const withoutCapabilityIds = (
  selection: AgentToolboxSelection,
  ids: string[],
): AgentToolboxSelection => {
  const dropped = new Set(ids);
  const keep = (bucket: string[]): string[] => bucket.filter(entry => !dropped.has(entry));
  return {
    subagents: keep(selection.subagents),
    direct: keep(selection.direct),
    custom: keep(selection.custom),
    gateway: keep(selection.gateway),
    callableAgents: keep(selection.callableAgents),
  };
};

export const bucketForCapabilityGroup = (
  group: AgentCapabilityGroup,
): keyof AgentToolboxSelection => {
  switch (group) {
    case 'subagent':
      return 'subagents';
    case 'agent':
      return 'callableAgents';
    case 'mcp':
      return 'direct';
    case 'builtin':
      return 'custom';
  }
};

export const withCapabilityIds = (
  selection: AgentToolboxSelection,
  group: AgentCapabilityGroup,
  ids: string[],
): AgentToolboxSelection => {
  const bucket = bucketForCapabilityGroup(group);
  const merged = new Set([...selection[bucket], ...ids]);
  return { ...selection, [bucket]: [...merged] };
};

export const toggleCapabilityIds = (
  selection: AgentToolboxSelection,
  group: AgentCapabilityGroup,
  ids: string[],
  selected: boolean,
): AgentToolboxSelection =>
  selected ? withoutCapabilityIds(selection, ids) : withCapabilityIds(selection, group, ids);

export const selectionHasAnyId = (selection: AgentToolboxSelection, ids: string[]): boolean => {
  const kept = new Set(flattenToolSelection(selection));
  return ids.some(id => kept.has(id));
};

export const providerDisplayName = (provider: string): string =>
  PROVIDER_DISPLAY[provider] ?? provider;

export const needsProviderKey = (provider: string | undefined): provider is string =>
  Boolean(provider) && provider !== 'spaces';

export const defaultModelLabel = (provider: string | undefined): string => {
  if (!provider || provider === 'spaces') return 'Platform default';
  return `${providerDisplayName(provider)} default`;
};

export const providerLine = (providerOrder: string[]): string =>
  providerOrder.length > 0 ? providerOrder.join(' → ') : 'Spaces default';

export const connectedProviderCount = (
  providers: ReadonlyArray<{ connected?: boolean }>,
): string => {
  const connected = providers.filter(provider => provider.connected).length;
  return `${connected} of ${providers.length} connected`;
};

export const buildModelOptions = (input: {
  modelId: string;
  provider?: string | undefined;
  catalog?: AgentModelOption[];
}): AgentModelOption[] => {
  const fallback: AgentModelOption = {
    value: PLATFORM_DEFAULT_MODEL,
    label: defaultModelLabel(input.provider),
  };
  const catalog = input.catalog ?? [];
  const extras =
    input.modelId && !catalog.some(option => option.value === input.modelId)
      ? [{ value: input.modelId, label: input.modelId }]
      : [];
  return [fallback, ...catalog, ...extras];
};

export type ManageToolItem = {
  id: string;
  name: string;
  description: string;
  ids: string[];
};

const humanizeSource = (source: string): string =>
  source
    .replace(/^custom:/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());

export const manageItemsFromCatalog = (
  tools: {
    subagents?: Array<{ name: string; description?: string }>;
    customGroups?: Array<{ source: string; tools: Array<{ slug: string; name: string }> }>;
    integrations?: Array<{
      slug: string;
      label: string;
      kind: string;
      readTools?: Array<{ slug: string; name: string }>;
      writeTools?: Array<{ slug: string; name: string }>;
    }>;
  } | null,
  group: Exclude<AgentCapabilityGroup, 'agent'>,
): ManageToolItem[] => {
  if (!tools) return [];

  if (group === 'subagent') {
    return (tools.subagents ?? []).map(subagent => ({
      id: subagent.name,
      name: subagent.name,
      description: subagent.description ?? '',
      ids: [subagent.name],
    }));
  }

  if (group === 'mcp') {
    return (tools.integrations ?? [])
      .filter(integration => integration.kind === 'mcp' || integration.kind === 'gateway')
      .map(integration => {
        const catalogTools = [...(integration.readTools ?? []), ...(integration.writeTools ?? [])];
        const ids = catalogTools.map(tool =>
          integration.kind === 'gateway' ? tool.slug : tool.name,
        );
        return {
          id: integration.slug,
          name: integration.label,
          description: ids.length === 1 ? (ids[0] ?? '') : `${ids.length} tools`,
          ids: ids.length > 0 ? ids : [integration.slug],
        };
      });
  }

  return (tools.customGroups ?? [])
    .map(groupEntry => {
      const integration = (tools.integrations ?? []).find(
        candidate => candidate.slug === groupEntry.source,
      );
      const ids = groupEntry.tools.map(tool => tool.slug);
      return {
        id: groupEntry.source,
        name: integration?.label || humanizeSource(groupEntry.source),
        description: ids.length === 1 ? (ids[0] ?? '') : `${ids.length} tools`,
        ids,
      };
    })
    .filter(entry => entry.ids.length > 0);
};

export const mergeManageItems = (
  catalogItems: ManageToolItem[],
  fallbackItems: ManageToolItem[],
): ManageToolItem[] => {
  const seen = new Set(catalogItems.map(item => item.id));
  return [...catalogItems, ...fallbackItems.filter(item => !seen.has(item.id))];
};

export const buildAgentEdits = (input: {
  selection: AgentToolboxSelection;
  modelId: string;
  providerOrder: string[];
}): AgentDraftEdits => ({
  toolSelection: input.selection,
  modelId: input.modelId.slice(0, 120),
  providerOrder: input.providerOrder,
});
