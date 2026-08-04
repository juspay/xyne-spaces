import { parseGatewaySource } from '@/components/ClawAgents/gatewayKeys';
import { deriveMcpCategory, type AgentCategoryId } from '@/services/claw/agentCategory';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import type {
  AvailableTools,
  IntegrationToolEntry,
  ToolboxSelection,
} from '@/services/claw/clawToolsTypes';

export type McpSelection = Required<ToolboxSelection>;

export interface McpCatalogEntry {
  slug: string;
  label: string;
  description: string;
  iconType: string;
  usageCount: number;
  tools: IntegrationToolEntry[];
  server: McpServer | undefined;
  category: AgentCategoryId;
  isGateway: boolean;
  verified: boolean;
  selectable: boolean;
}

function metaString(server: McpServer, key: string): string | undefined {
  const value = server.connectorMeta?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

function isVerified(server: McpServer | undefined): boolean {
  if (!server) return false;
  const scope = metaString(server, 'scope');
  const publishStatus = metaString(server, 'publishStatus');
  if (!scope && !publishStatus) return true;
  return scope === 'global' || scope === 'built-in';
}

export function buildMcpCatalog(
  availableTools: AvailableTools | null,
  servers: readonly McpServer[],
): McpCatalogEntry[] {
  if (!availableTools) return [];
  const serverByType = new Map(servers.map(server => [server.type, server]));

  return availableTools.integrations
    .filter(integration => integration.kind === 'mcp' || integration.kind === 'gateway')
    .map(integration => {
      const isGateway = integration.kind === 'gateway';
      const server = serverByType.get(integration.slug);
      const tools = [...integration.readTools, ...integration.writeTools];
      return {
        slug: integration.slug,
        label: integration.label,
        description: server?.description ?? '',
        iconType: isGateway ? '' : integration.slug,
        usageCount: integration.usageCount,
        tools,
        server,
        category: server ? deriveMcpCategory(server) : 'other',
        isGateway,
        verified: isVerified(server),
        selectable: tools.length > 0,
      };
    });
}

export function toolSelectionKey(entry: McpCatalogEntry, tool: IntegrationToolEntry): string {
  return entry.isGateway ? tool.slug : tool.name;
}

function gatewayServiceOf(entry: McpCatalogEntry): string | null {
  if (!entry.isGateway) return null;
  return parseGatewaySource(entry.slug)?.serviceName ?? null;
}

function gatewayKeysForService(catalog: readonly McpCatalogEntry[], serviceName: string): string[] {
  return catalog.flatMap(entry =>
    gatewayServiceOf(entry) === serviceName ? entry.tools.map(tool => tool.slug) : [],
  );
}

export function isToolSelected(
  selection: ToolboxSelection,
  entry: McpCatalogEntry,
  tool: IntegrationToolEntry,
): boolean {
  if (selection.direct.includes(toolSelectionKey(entry, tool))) return true;
  const service = gatewayServiceOf(entry);
  return !!service && (selection.gateway ?? []).includes(service);
}

export function selectedTools(
  selection: ToolboxSelection,
  entry: McpCatalogEntry,
): IntegrationToolEntry[] {
  return entry.tools.filter(tool => isToolSelected(selection, entry, tool));
}

export function isEntryEnabled(selection: ToolboxSelection, entry: McpCatalogEntry): boolean {
  return entry.tools.some(tool => isToolSelected(selection, entry, tool));
}

export function setToolsSelected(
  catalog: readonly McpCatalogEntry[],
  selection: ToolboxSelection,
  entry: McpCatalogEntry,
  tools: readonly IntegrationToolEntry[],
  next: boolean,
): McpSelection {
  const base: McpSelection = {
    subagents: selection.subagents,
    direct: selection.direct,
    custom: selection.custom,
    gateway: selection.gateway ?? [],
  };
  if (tools.length === 0) return base;

  const service = gatewayServiceOf(entry);
  if (!service) {
    const touched = new Set(tools.map(tool => tool.name));
    const rest = base.direct.filter(key => !touched.has(key));
    return { ...base, direct: next ? [...rest, ...touched] : rest };
  }

  const serviceKeys = gatewayKeysForService(catalog, service);
  const serviceKeySet = new Set(serviceKeys);
  const selected = new Set<string>(
    base.gateway.includes(service)
      ? serviceKeys
      : base.direct.filter(key => serviceKeySet.has(key)),
  );
  for (const tool of tools) {
    if (next) selected.add(tool.slug);
    else selected.delete(tool.slug);
  }
  return {
    ...base,
    gateway: base.gateway.filter(candidate => candidate !== service),
    direct: [
      ...base.direct.filter(key => !serviceKeySet.has(key)),
      ...serviceKeys.filter(key => selected.has(key)),
    ],
  };
}

export function enableEntry(
  catalog: readonly McpCatalogEntry[],
  selection: ToolboxSelection,
  entry: McpCatalogEntry,
  tools?: readonly IntegrationToolEntry[],
): McpSelection {
  const target = tools && tools.length > 0 ? tools : entry.tools;
  return setToolsSelected(catalog, selection, entry, target, true);
}

export function disableEntry(
  catalog: readonly McpCatalogEntry[],
  selection: ToolboxSelection,
  entry: McpCatalogEntry,
): McpSelection {
  return setToolsSelected(catalog, selection, entry, entry.tools, false);
}

export function humanizeToolName(name: string): string {
  return name.replace(/_/g, ' ').replace(/^[a-z]/, char => char.toUpperCase());
}
