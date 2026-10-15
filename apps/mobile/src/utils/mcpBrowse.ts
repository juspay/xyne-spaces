import type { Integration } from '@/src/services/claw/clawToolsTypes';
import type { McpServer, UserConnection } from '@/src/services/claw/clawMcpTypes';

export type McpBrowseCategoryId =
  'popular' | 'communication' | 'code' | 'data' | 'research' | 'productivity' | 'other';

export type McpBrowseItem = {
  id: string;
  name: string;
  description: string;
  type: string;
  url: string;
  transport: string;
  connected: boolean;
  scope: string;
  author: string;
  usageCount: number;
  toolIds: string[];
  tools: Array<{ id: string; name: string; description: string }>;
};

export type McpBrowseSection = {
  id: McpBrowseCategoryId;
  label: string;
  items: McpBrowseItem[];
};

const CATEGORY_LABEL: Record<Exclude<McpBrowseCategoryId, 'popular'>, string> = {
  communication: 'Communication',
  code: 'Code',
  data: 'Data',
  research: 'Research',
  productivity: 'Productivity',
  other: 'Other',
};

export type McpBrowseFilter = 'all' | Exclude<McpBrowseCategoryId, 'popular'>;

const CATEGORY_ORDER: Exclude<McpBrowseCategoryId, 'popular'>[] = [
  'communication',
  'code',
  'data',
  'research',
  'productivity',
  'other',
];

export const MCP_FILTER_OPTIONS: Array<{ id: McpBrowseFilter; label: string }> = [
  { id: 'all', label: 'All' },
  ...CATEGORY_ORDER.map(id => ({ id, label: CATEGORY_LABEL[id] })),
];

const TYPE_TO_CATEGORY: Record<string, Exclude<McpBrowseCategoryId, 'popular'>> = {
  slack: 'communication',
  gmail: 'communication',
  google: 'communication',
  microsoft: 'communication',
  asana: 'communication',
  notion: 'communication',
  hubspot: 'communication',
  intercom: 'communication',
  salesforce: 'communication',
  calendly: 'communication',
  github: 'code',
  gitlab: 'code',
  bitbucket: 'code',
  bigquery: 'data',
  databricks: 'data',
  amplitude: 'data',
  mixpanel: 'data',
  grafana: 'data',
  kibana: 'data',
  'google-drive': 'productivity',
  egnyte: 'productivity',
  docusign: 'productivity',
  jotform: 'productivity',
  figma: 'productivity',
};

const AUTHOR_MAP: Record<string, string> = {
  github: 'GitHub',
  gitlab: 'GitLab',
  google: 'Google',
  gmail: 'Google',
  'google-drive': 'Google',
  microsoft: 'Microsoft',
  slack: 'Slack',
  figma: 'Figma',
  notion: 'Notion',
  grafana: 'Grafana',
  bitbucket: 'Atlassian',
  hubspot: 'HubSpot',
  intercom: 'Intercom',
  asana: 'Asana',
  calendly: 'Calendly',
  'xyne-spaces': 'Xyne',
};

const POPULAR_HINTS = ['xyne-spaces', 'bitbucket', 'google', 'grafana'];

const humanize = (value: string): string =>
  value.replace(/[-_]/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

const categoryForType = (
  type: string,
  haystack: string,
): Exclude<McpBrowseCategoryId, 'popular'> => {
  const mapped = TYPE_TO_CATEGORY[type.toLowerCase()];
  if (mapped) return mapped;
  if (/slack|gmail|mail|outlook|teams|asana|calendar|hubspot|intercom|zendesk/i.test(haystack)) {
    return 'communication';
  }
  if (/github|gitlab|bitbucket|\bgit\b/i.test(haystack)) return 'code';
  if (/grafana|postgres|sql|databricks|mixpanel/i.test(haystack)) return 'data';
  if (/\bsearch\b|wikipedia|web/i.test(haystack)) return 'research';
  if (/drive|docs|pdf|files/i.test(haystack)) return 'productivity';
  return 'other';
};

export const buildMcpBrowseItems = (
  servers: McpServer[],
  connections: UserConnection[],
  integrations: Integration[] | undefined,
): McpBrowseItem[] => {
  const connectedIds = new Set(connections.map(connection => connection.mcpServerId));
  const integrationBySlug = new Map((integrations ?? []).map(entry => [entry.slug, entry]));

  if (servers.length > 0) {
    return servers.map(server => {
      const integration =
        integrationBySlug.get(server.type) ??
        integrationBySlug.get(server.id) ??
        (integrations ?? []).find(entry => entry.label.toLowerCase() === server.name.toLowerCase());
      const catalogTools = [...(integration?.readTools ?? []), ...(integration?.writeTools ?? [])];
      const policyTools = server.writeToolPolicy?.tools ?? [];
      const tools =
        catalogTools.length > 0
          ? catalogTools.map(tool => ({
              id: integration?.kind === 'gateway' ? tool.slug : tool.name,
              name: tool.name.replace(/[_-]+/g, ' '),
              description: tool.description,
            }))
          : policyTools.map(name => ({
              id: name,
              name: name.replace(/[_-]+/g, ' '),
              description: '',
            }));
      const toolIds = tools.map(tool => tool.id);
      const rawScope = server.connectorMeta?.['scope'];
      return {
        id: server.id,
        name: server.name,
        description: server.description?.trim() || integration?.label || '',
        type: server.type,
        url: server.url,
        transport: server.transport || 'stdio',
        connected: connectedIds.has(server.id) || Boolean(integration?.connected),
        scope:
          typeof rawScope === 'string' && rawScope.trim()
            ? rawScope.replace(/^\w/, char => char.toUpperCase())
            : 'Global',
        author: AUTHOR_MAP[server.type] ?? server.name,
        usageCount: integration?.usageCount ?? 0,
        toolIds: toolIds.length > 0 ? toolIds : [server.type],
        tools,
      };
    });
  }

  return (integrations ?? [])
    .filter(integration => integration.kind === 'mcp' || integration.kind === 'gateway')
    .map(integration => {
      const catalogTools = [...(integration.readTools ?? []), ...(integration.writeTools ?? [])];
      const toolIds = catalogTools.map(tool =>
        integration.kind === 'gateway' ? tool.slug : tool.name,
      );
      return {
        id: integration.slug,
        name: integration.label,
        description:
          catalogTools.length === 1
            ? (catalogTools[0]?.name ?? '')
            : `${catalogTools.length} tools`,
        type: integration.slug,
        url: '',
        transport: 'stdio',
        connected: integration.connected,
        scope: 'Global',
        author: AUTHOR_MAP[integration.slug] ?? integration.label,
        usageCount: integration.usageCount,
        toolIds: toolIds.length > 0 ? toolIds : [integration.slug],
        tools: catalogTools.map(tool => ({
          id: integration.kind === 'gateway' ? tool.slug : tool.name,
          name: tool.name.replace(/[_-]+/g, ' '),
          description: tool.description,
        })),
      };
    });
};

export const groupMcpBrowseItems = (items: McpBrowseItem[]): McpBrowseSection[] => {
  const popular = [...items]
    .sort((left, right) => {
      if (right.usageCount !== left.usageCount) return right.usageCount - left.usageCount;
      return (
        POPULAR_HINTS.indexOf(left.type) - POPULAR_HINTS.indexOf(right.type) ||
        left.name.localeCompare(right.name)
      );
    })
    .slice(0, 4);
  const buckets = new Map<Exclude<McpBrowseCategoryId, 'popular'>, McpBrowseItem[]>();
  for (const id of CATEGORY_ORDER) buckets.set(id, []);
  for (const item of items) {
    const category = categoryForType(item.type, `${item.name} ${item.type} ${item.description}`);
    buckets.get(category)?.push(item);
  }

  const sections: McpBrowseSection[] = [];
  if (popular.length > 0) {
    sections.push({ id: 'popular', label: 'Popular', items: popular });
  }
  for (const id of CATEGORY_ORDER) {
    const grouped = buckets.get(id) ?? [];
    if (grouped.length === 0) continue;
    sections.push({ id, label: CATEGORY_LABEL[id], items: grouped });
  }
  return sections;
};

export const mcpInitials = (name: string): string => {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export const humanizeMcpType = humanize;
