import type {
  FlowComponentLike,
  FlowDefinitionLike,
  FlowTextNormalizationOptions,
} from '@/src/utils/flowJsonMarkdown';

export type McpSuggestConnector = {
  serverType: string;
  name: string;
  description?: string;
  connected: boolean;
};

export type McpSuggestViewModel = {
  componentId: string;
  title: string;
  connectors: McpSuggestConnector[];
  browseAll: boolean;
  totalCount?: number;
  footerLabel: string;
};

const DEFAULT_TITLE = 'Connectors that could help';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const optionalString = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined;

const requiredString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

export const parseMcpSuggestConnectors = (value: unknown): McpSuggestConnector[] => {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isRecord)
    .map(raw => {
      const serverType = requiredString(raw['serverType']);
      const name = requiredString(raw['name']);
      if (!serverType || !name) return null;
      const description = optionalString(raw['description']);
      return {
        serverType,
        name,
        ...(description ? { description } : {}),
        connected: raw['connected'] === true,
      };
    })
    .filter((item): item is McpSuggestConnector => item !== null);
};

export const createMcpSuggestViewModel = (
  component: FlowComponentLike,
): McpSuggestViewModel | null => {
  if (component.type !== 'mcp_suggest') return null;

  const componentId =
    typeof component.id === 'string' && component.id.trim() ? component.id.trim() : 'mcp-suggest';
  const props = isRecord(component.props) ? component.props : undefined;
  const connectors = parseMcpSuggestConnectors(props?.['connectors']);
  if (connectors.length === 0) return null;

  const browseAll = props?.['browseAll'] === true;
  const totalCount =
    typeof props?.['totalCount'] === 'number' &&
    Number.isFinite(props['totalCount']) &&
    props['totalCount'] >= 0
      ? Math.floor(props['totalCount'])
      : undefined;

  const footerLabel =
    browseAll && totalCount !== undefined && totalCount > connectors.length
      ? `${totalCount} connectors available`
      : 'All connectors';

  return {
    componentId,
    title: optionalString(props?.['title']) ?? DEFAULT_TITLE,
    connectors,
    browseAll,
    ...(totalCount !== undefined ? { totalCount } : {}),
    footerLabel,
  };
};

export const findMcpSuggestComponent = (
  components: FlowComponentLike[] | undefined,
): FlowComponentLike | undefined => {
  if (!components) return undefined;
  for (const component of components) {
    if (component.type === 'mcp_suggest') return component;
    const nested = findMcpSuggestComponent(component.children);
    if (nested) return nested;
  }
  return undefined;
};

export const isMcpSuggestFlow = (flow: { components?: FlowComponentLike[] | undefined }): boolean =>
  findMcpSuggestComponent(flow.components) !== undefined;

export const mcpSuggestComponentToMarkdown = (
  component: FlowComponentLike,
  _options: FlowTextNormalizationOptions = {},
): string => {
  const viewModel = createMcpSuggestViewModel(component);
  if (!viewModel) return '';

  const lines = [`**${viewModel.title}**`];
  for (const connector of viewModel.connectors) {
    const status = connector.connected ? 'Connected' : 'Connect';
    const description = connector.description ? ` — ${connector.description}` : '';
    lines.push(`- ${connector.name}${description} (${status})`);
  }
  if (viewModel.browseAll) {
    lines.push(`${viewModel.footerLabel} · Browse MCPs`);
  }
  return lines.join('\n');
};

export const mcpSuggestFlowToMarkdown = (
  flow: FlowDefinitionLike,
  options: FlowTextNormalizationOptions = {},
): string => {
  const component = findMcpSuggestComponent(flow.components);
  if (!component) return '';
  return mcpSuggestComponentToMarkdown(component, options);
};

export const mcpSuggestNotificationPreview = (viewModel: McpSuggestViewModel): string => {
  const names = viewModel.connectors.map(connector => connector.name).filter(Boolean);
  if (names.length === 0) return viewModel.title;
  if (names.length <= 3) return `${viewModel.title}: ${names.join(', ')}`;
  return `${viewModel.title}: ${names.slice(0, 3).join(', ')} +${names.length - 3}`;
};

/** Initials fallback matching dashboard McpLogo when no icon asset is available. */
export const mcpSuggestInitials = (name: string): string => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }
  return name.trim().slice(0, 2).toUpperCase() || '?';
};
