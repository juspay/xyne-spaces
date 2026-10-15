import type { FlowCardStatusTone } from '@/src/utils/flowCardTypes';
import {
  defaultModelLabel,
  parseToolSelection,
  providerLine,
  type AgentToolboxSelection,
} from '@/src/utils/flowAgentEditor';
import type {
  FlowComponentLike,
  FlowDefinitionLike,
  FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

export type AgentCardVariant = 'draft' | 'profile';
export type AgentDraftPhase = 'pending' | 'created' | 'rejected';

/**
 * Whether the agent preview sheet should collapse because the draft left the
 * pending phase. Do not couple this to `isSubmitting` — closing on submit start
 * races the sheet's failure path, which keeps the sheet open so errors stay visible.
 */
export const shouldCloseAgentPreviewForPhase = (phase: AgentDraftPhase | undefined): boolean =>
  phase !== 'pending';

/**
 * Whether the agent preview sheet should close after an approve/decline action.
 * `false` means failure — leave the sheet open. `true` / `void` means success.
 */
export const shouldCloseAgentPreviewAfterAction = (succeeded: boolean | void): boolean =>
  succeeded !== false;

export type AgentCapabilityGroup = 'subagent' | 'agent' | 'mcp' | 'builtin';

export type AgentCapabilityViewModel = {
  id: string;
  label: string;
  kind: 'subagent' | 'tool';
  group: AgentCapabilityGroup;
  description?: string;
  parentId?: string;
  parentLabel?: string;
  requiresConnection?: string;
};

export type AgentPreviewListItem = {
  id: string;
  name: string;
  description: string;
  ids?: string[];
};

export type AgentPreviewDetail = {
  label: string;
  value: string;
};

export type AgentProviderStatus = {
  connected: boolean;
};

export type AgentConnectLink = {
  serverType: string;
  displayName: string;
  authUrl: string;
};

export const AGENT_PREVIEW_TABS = [
  { id: 'persona', label: 'Persona' },
  { id: 'tools', label: 'Tools' },
  { id: 'knowledge', label: 'Knowledge' },
] as const;

export type AgentPreviewTabId = (typeof AGENT_PREVIEW_TABS)[number]['id'];

export const AGENT_TOOL_SECTIONS: {
  group: AgentCapabilityGroup;
  label: string;
  empty: string;
}[] = [
  { group: 'subagent', label: 'Subagents', empty: 'No subagents added yet.' },
  { group: 'agent', label: 'Agents', empty: 'No agents added yet.' },
  { group: 'mcp', label: 'MCP Tools', empty: 'No MCPs added yet.' },
  { group: 'builtin', label: 'Built-In tools', empty: 'No built-in tools added yet.' },
];

export type AgentCardViewModel = {
  title: string;
  statusLabel: string;
  statusTone: FlowCardStatusTone;
  name: string;
  slug: string;
  description: string;
  variant: AgentCardVariant;
  phase?: AgentDraftPhase;
  auditLine?: string;
  footnote?: string;
  showActions: boolean;
  /** Draft pending/rejected — dashboard Maximize control (not a Flow submit). */
  showExpandAction: boolean;
  /** Created draft / profile — open `/ai/library/agent/{slug}`. Not a Flow submit. */
  showViewAction: boolean;
  /** Created draft / profile — open `/ai/chat/new?agent={slug}`. Not a Flow submit. */
  showChatAction: boolean;
  capabilities: AgentCapabilityViewModel[];
  systemPrompt?: string;
  modelId?: string;
  modelLabel: string;
  providerLabel: string;
  skills: AgentPreviewListItem[];
  knowledgeSources: AgentPreviewListItem[];
  knowledgeAppliesTo: string;
  memoryEnabled: boolean;
  memoryRequiresApproval: boolean;
  connectLinks: AgentConnectLink[];
  details: AgentPreviewDetail[];
  providers: AgentProviderStatus[];
  componentId: string;
  canEditDraft: boolean;
  initialToolSelection: AgentToolboxSelection | null;
  initialModelId: string;
  initialProviderOrder: string[];
  posterSlug: string;
  cardUserId: string;
  /** After Create / Decline — avatar + name row (dashboard parity). */
  decidedByUserId?: string;
  decidedByName?: string;
  decidedByLabel?: string;
};

const DEFAULT_TITLE = 'Agent';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const getStringProp = (props: Record<string, unknown> | undefined, key: string): string =>
  optionalString(props?.[key]) ?? '';

const parseVariant = (value: unknown): AgentCardVariant | null => {
  if (value === 'profile') return 'profile';
  if (value === 'draft') return 'draft';
  return null;
};

const resolveCardVariant = (
  props: Record<string, unknown> | undefined,
  flow: FlowDefinitionLike,
): AgentCardVariant | null => {
  const raw = props?.['variant'] ?? flow.data?.['variant'];
  if (raw === 'summary' || raw === 'profile-list') return null;
  return parseVariant(raw) ?? 'draft';
};

const parsePhase = (value: unknown): AgentDraftPhase | undefined => {
  if (value === 'pending' || value === 'created' || value === 'rejected') return value;
  return undefined;
};

export const agentLibraryPath = (slug: string): string =>
  `/ai/library/agent/${encodeURIComponent(slug)}?tab=persona`;

export const agentChatPath = (slug: string): string =>
  `/ai/chat/new?agent=${encodeURIComponent(slug)}`;

export type AgentSummaryEntry = {
  name: string;
  slug: string;
};

export const getAgentSummaryEntries = (
  props: Record<string, unknown> | undefined,
): AgentSummaryEntry[] => {
  const raw = Array.isArray(props?.['agents'])
    ? props['agents']
    : Array.isArray(props?.['items'])
      ? props['items']
      : [];
  return raw
    .filter(isRecord)
    .map(entry => {
      const name = getStringProp(entry, 'name');
      const slug = getStringProp(entry, 'slug');
      return name && slug ? { name, slug } : null;
    })
    .filter((entry): entry is AgentSummaryEntry => entry !== null);
};

export const findAgentComponent = (
  components: FlowComponentLike[] | undefined,
): FlowComponentLike | undefined => {
  if (!components) return undefined;
  for (const component of components) {
    if (component.type === 'agent') return component;
    const nested = findAgentComponent(component.children);
    if (nested) return nested;
  }
  return undefined;
};

export const isAgentCardFlow = (flow: FlowDefinitionLike): boolean => {
  if (flow.data?.['actionType'] === 'agent-card') return true;
  const screenId = typeof flow.screenId === 'string' ? flow.screenId.trim() : '';
  if (screenId.startsWith('agent-card')) return true;
  return findAgentComponent(flow.components) !== undefined;
};

export const canUserActOnAgentCard = (
  flow: FlowDefinitionLike,
  currentUserId?: string,
): boolean => {
  const ownerId = optionalString(flow.data?.['userId']);
  if (!ownerId || !currentUserId) return false;
  return currentUserId === ownerId;
};

export const resolveAgentStatus = (
  variant: AgentCardVariant,
  phase: AgentDraftPhase | undefined,
): { statusLabel: string; statusTone: FlowCardStatusTone } => {
  if (variant === 'profile') {
    return { statusLabel: 'Created', statusTone: 'completed' };
  }

  switch (phase) {
    case 'created':
      return { statusLabel: 'Created', statusTone: 'completed' };
    case 'rejected':
      return { statusLabel: 'Declined', statusTone: 'failed' };
    case 'pending':
    default:
      return { statusLabel: 'Draft', statusTone: 'pending' };
  }
};

const parseCapabilityGroup = (value: unknown, kind: 'subagent' | 'tool'): AgentCapabilityGroup => {
  if (value === 'subagent' || value === 'agent' || value === 'mcp' || value === 'builtin') {
    return value;
  }
  return kind === 'subagent' ? 'subagent' : 'builtin';
};

export const getAgentCapabilities = (
  props: Record<string, unknown> | undefined,
): AgentCapabilityViewModel[] => {
  const agent = isRecord(props?.['agent']) ? props['agent'] : undefined;
  const capabilities = Array.isArray(agent?.['capabilities'])
    ? agent['capabilities']
    : Array.isArray(props?.['capabilities'])
      ? props['capabilities']
      : [];
  return capabilities
    .filter(isRecord)
    .map(capability => {
      const id =
        getStringProp(capability, 'id') ||
        getStringProp(capability, 'name') ||
        getStringProp(capability, 'slug');
      const label = getStringProp(capability, 'label') || getStringProp(capability, 'name') || id;
      const kind = capability['kind'] === 'tool' ? 'tool' : 'subagent';
      const description = getStringProp(capability, 'description');
      const parentId = getStringProp(capability, 'parentId');
      const parentLabel = getStringProp(capability, 'parentLabel');
      const requiresConnection = getStringProp(capability, 'requiresConnection');
      return id
        ? {
            id,
            label,
            kind,
            group: parseCapabilityGroup(capability['group'], kind),
            ...(description ? { description } : {}),
            ...(parentId ? { parentId } : {}),
            ...(parentLabel ? { parentLabel } : {}),
            ...(requiresConnection ? { requiresConnection } : {}),
          }
        : null;
    })
    .filter((capability): capability is AgentCapabilityViewModel => capability !== null);
};

const readListItems = (value: unknown, nameKey: string): AgentPreviewListItem[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map(item => {
      const id = getStringProp(item, 'id');
      const name = getStringProp(item, nameKey) || id;
      const description = getStringProp(item, 'description');
      const kind = getStringProp(item, 'kind');
      return id
        ? {
            id,
            name,
            description:
              description || (kind === 'file' ? 'File' : kind === 'collection' ? 'Collection' : ''),
          }
        : null;
    })
    .filter((item): item is AgentPreviewListItem => item !== null);
};

export const capabilitiesForGroup = (
  capabilities: AgentCapabilityViewModel[],
  group: AgentCapabilityGroup,
): AgentCapabilityViewModel[] => capabilities.filter(capability => capability.group === group);

const humanizeToolName = (label: string): string => label.replace(/[_-]+/g, ' ').trim();

const capabilityDescription = (capability: AgentCapabilityViewModel): string => {
  if (capability.description) return capability.description;
  return capability.requiresConnection ? `Needs ${capability.requiresConnection} connected` : '';
};

export const toolItemsForGroup = (
  capabilities: AgentCapabilityViewModel[],
  group: AgentCapabilityGroup,
): AgentPreviewListItem[] => {
  const items: AgentPreviewListItem[] = [];
  const grouped = new Map<string, { item: AgentPreviewListItem; labels: string[] }>();

  for (const capability of capabilities) {
    if (capability.group !== group) continue;

    const parentId = capability.parentId;
    if (!parentId) {
      items.push({
        id: capability.id,
        name: capability.label,
        description: capabilityDescription(capability),
        ids: [capability.id],
      });
      continue;
    }

    const existing = grouped.get(parentId);
    if (existing) {
      existing.labels.push(humanizeToolName(capability.label));
      existing.item.description = existing.labels.join(', ');
      existing.item.ids = [...(existing.item.ids ?? []), capability.id];
      continue;
    }

    const item: AgentPreviewListItem = {
      id: parentId,
      name: capability.parentLabel ?? parentId,
      description: humanizeToolName(capability.label),
      ids: [capability.id],
    };
    grouped.set(parentId, { item, labels: [humanizeToolName(capability.label)] });
    items.push(item);
  }

  return items;
};

export const getDefaultAgentCapabilitySelection = (
  props: Record<string, unknown> | undefined,
): string[] => {
  const selected = Array.isArray(props?.['selected'])
    ? props['selected'].map(String).filter(Boolean)
    : [];
  if (selected.length > 0) return selected;
  return getAgentCapabilities(props).map(capability => capability.id);
};

const buildAuditLine = (
  variant: AgentCardVariant,
  phase: AgentDraftPhase | undefined,
  props: Record<string, unknown> | undefined,
): string | undefined => {
  const decidedBy = getStringProp(props, 'decidedBy');
  const ownedBy = getStringProp(isRecord(props?.['agent']) ? props['agent'] : undefined, 'ownedBy');
  const scope = getStringProp(isRecord(props?.['agent']) ? props['agent'] : undefined, 'scope');

  if (variant === 'profile') {
    if (ownedBy) return `Created by @${ownedBy}`;
    if (scope === 'global') return 'Global agent';
    return undefined;
  }

  if (phase === 'created' && decidedBy) return `Created by @${decidedBy}`;
  if (phase === 'rejected' && decidedBy) return `Declined by @${decidedBy}`;
  return undefined;
};

export const createAgentCardViewModel = (
  component: FlowComponentLike,
  flow: FlowDefinitionLike,
  normalizeText: (text: string) => string,
  _options: {
    currentUserId?: string;
  } = {},
): AgentCardViewModel | null => {
  if (component.type !== 'agent') return null;

  const props = isRecord(component.props) ? component.props : undefined;
  const agent = isRecord(props?.['agent']) ? props['agent'] : undefined;
  if (!agent) return null;

  const name = getStringProp(agent, 'name');
  const slug = getStringProp(agent, 'slug');
  if (!name || !slug) return null;

  const variant = resolveCardVariant(props, flow);
  if (!variant) return null;

  const phase = variant === 'draft' ? (parsePhase(props?.['phase']) ?? 'pending') : undefined;
  const { statusLabel, statusTone } = resolveAgentStatus(variant, phase);
  const description = normalizeText(getStringProp(agent, 'description'));
  const footnote = optionalString(props?.['note']);
  // Dashboard DraftAgentCard always paints Decline / Create on pending. Authz is
  // server-side (`data.userId`); hiding here is why mobile looked actionless.
  const showActions = variant === 'draft' && phase === 'pending';
  const showExpandAction = variant === 'draft' && phase !== 'created';
  const showLibraryActions = variant === 'profile' || (variant === 'draft' && phase === 'created');
  const systemPrompt = optionalString(agent['systemPrompt']);
  const modelId = optionalString(agent['modelId']);
  const providerOrder = Array.isArray(agent['providerOrder'])
    ? agent['providerOrder'].map(String).filter(Boolean)
    : [];
  const knowledge = isRecord(agent['knowledge']) ? agent['knowledge'] : undefined;
  const memory = isRecord(agent['memory']) ? agent['memory'] : undefined;
  const auditLine = buildAuditLine(variant, phase, props);
  const decidedByName = getStringProp(props, 'decidedBy');
  const decidedByUserId = getStringProp(props, 'decidedById');
  const decidedByLabel =
    phase === 'created' ? 'Created by' : phase === 'rejected' ? 'Declined by' : undefined;
  const details = Array.isArray(agent['details'])
    ? agent['details']
        .filter(isRecord)
        .map(detail => {
          const label = getStringProp(detail, 'label');
          const value = getStringProp(detail, 'value');
          return label ? { label, value } : null;
        })
        .filter((detail): detail is { label: string; value: string } => detail !== null)
    : [];
  const providers = Array.isArray(agent['providers'])
    ? agent['providers']
        .filter(isRecord)
        .map(provider => ({ connected: provider['connected'] === true }))
    : [];
  const componentId = optionalString(component.id) || 'agent';

  return {
    title: DEFAULT_TITLE,
    statusLabel,
    statusTone,
    name,
    slug,
    description,
    variant,
    ...(phase ? { phase } : {}),
    ...(auditLine ? { auditLine } : {}),
    ...(footnote ? { footnote: normalizeText(footnote) } : {}),
    ...(decidedByLabel && (decidedByName || decidedByUserId)
      ? {
          decidedByLabel,
          ...(decidedByUserId ? { decidedByUserId } : {}),
          ...(decidedByName ? { decidedByName } : {}),
        }
      : {}),
    showActions,
    showExpandAction,
    showViewAction: showLibraryActions,
    showChatAction: showLibraryActions,
    capabilities: getAgentCapabilities(props),
    modelLabel: modelId || defaultModelLabel(providerOrder[0]),
    providerLabel: providerLine(providerOrder),
    details,
    providers,
    componentId,
    canEditDraft: phase === 'pending' && props?.['toolSelection'] !== undefined,
    initialToolSelection: parseToolSelection(props?.['toolSelection']),
    initialModelId: modelId ?? '',
    initialProviderOrder: providerOrder,
    posterSlug: optionalString(flow.data?.['agentSlug']) ?? '',
    cardUserId: optionalString(flow.data?.['userId']) ?? '',
    skills: readListItems(agent['skills'], 'name'),
    knowledgeSources: readListItems(knowledge?.['sources'], 'name'),
    knowledgeAppliesTo:
      knowledge?.['scope'] === 'USER' ? "Each user's own access" : 'The collections below',
    memoryEnabled: memory?.['enabled'] === true,
    memoryRequiresApproval: memory?.['requiresApproval'] === true,
    connectLinks: Array.isArray(agent['connectLinks'])
      ? agent['connectLinks']
          .filter(isRecord)
          .map(link => {
            const serverType = getStringProp(link, 'serverType');
            const displayName = getStringProp(link, 'displayName') || serverType;
            const authUrl = getStringProp(link, 'authUrl');
            return serverType && authUrl ? { serverType, displayName, authUrl } : null;
          })
          .filter((link): link is AgentConnectLink => link !== null)
      : [],
    ...(systemPrompt ? { systemPrompt: normalizeText(systemPrompt) } : {}),
    ...(modelId ? { modelId } : {}),
  };
};

export const agentComponentToMarkdown = (
  component: FlowComponentLike,
  normalizeText: (text: string) => string,
  options: FlowTextNormalizationOptions = {},
): string => {
  if (component.type !== 'agent') return '';

  const props = isRecord(component.props) ? component.props : undefined;
  const agent = isRecord(props?.['agent']) ? props['agent'] : undefined;
  if (!agent) return '';

  const name = getStringProp(agent, 'name');
  const slug = getStringProp(agent, 'slug');
  if (!name || !slug) return '';

  const variant = parseVariant(props?.['variant']) ?? 'draft';
  const phase = variant === 'draft' ? (parsePhase(props?.['phase']) ?? 'pending') : undefined;
  const { statusLabel } = resolveAgentStatus(variant, phase);
  const description = normalizeText(getStringProp(agent, 'description'));
  const lines = [`# ${DEFAULT_TITLE}`, `**${statusLabel}**`, `**${name}**`, `@${slug}`];

  if (description.trim()) lines.push(description);

  if (!options.omitButtons && variant === 'draft' && phase === 'pending') {
    lines.push('**Create Agent**');
    lines.push('**Decline**');
  }

  return lines.filter(line => line.trim().length > 0).join('\n\n');
};

export const agentCardFlowToMarkdown = (
  flow: FlowDefinitionLike,
  normalizeText: (text: string) => string,
  options: FlowTextNormalizationOptions = {},
): string => {
  const component = findAgentComponent(flow.components);
  if (!component) return '';

  const currentUserId = optionalString(flow.data?.['userId']);
  const viewModel = createAgentCardViewModel(component, flow, normalizeText, {
    ...(currentUserId ? { currentUserId } : {}),
  });
  if (!viewModel) return '';

  const lines = [`# ${viewModel.title}`, `**${viewModel.name}**`, `@${viewModel.slug}`];

  if (viewModel.description.trim()) lines.push(viewModel.description);
  if (viewModel.auditLine) lines.push(viewModel.auditLine);
  if (viewModel.footnote) lines.push(viewModel.footnote);

  if (!options.omitButtons && viewModel.showActions) {
    lines.push('**Create Agent**');
    lines.push('**Decline**');
  }

  return lines.filter(line => line.trim().length > 0).join('\n\n');
};
