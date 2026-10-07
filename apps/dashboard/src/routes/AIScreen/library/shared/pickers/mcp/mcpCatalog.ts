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
  scope: McpScope;
  selectable: boolean;
  /**
   * Its tool names that another connector has too (GitHub's and Bitbucket's
   * merge_pull_request). Those are picked with the connector in front, so
   * picking one doesn't pick both.
   */
  sharedToolNames?: ReadonlySet<string>;
}

/** A tool picked with its connector in front, which claw-auth and claw read as that connector's only. */
export function scopedToolKey(serverType: string, toolName: string): string {
  return `${serverType}__${toolName}`;
}

/** Tool names more than one MCP connector has. */
export function sharedMcpToolNames(
  integrations: AvailableTools['integrations'],
): ReadonlySet<string> {
  const owners = new Map<string, number>();
  for (const integration of integrations) {
    if (integration.kind !== 'mcp') continue;
    const names = new Set(
      [...integration.readTools, ...integration.writeTools].map(tool => tool.name),
    );
    for (const name of names) owners.set(name, (owners.get(name) ?? 0) + 1);
  }
  return new Set([...owners].filter(([, count]) => count > 1).map(([name]) => name));
}

function metaString(server: McpServer, key: string): string | undefined {
  const value = server.connectorMeta?.[key];
  return typeof value === 'string' && value ? value : undefined;
}

export type McpScope = 'global' | 'personal' | 'built-in' | 'unknown';

export function connectorScope(server: McpServer | undefined): McpScope {
  if (!server) return 'unknown';
  const scope = metaString(server, 'scope');
  if (scope === 'global' || scope === 'personal' || scope === 'built-in') return scope;
  return metaString(server, 'publishStatus') ? 'unknown' : 'built-in';
}

const SCOPE_LABELS = new Map<McpScope, string>([
  ['global', 'Global'],
  ['personal', 'Personal'],
  ['built-in', 'Built-in'],
  ['unknown', 'Unlisted'],
]);

export function scopeLabel(scope: McpScope): string {
  return SCOPE_LABELS.get(scope) ?? 'Unlisted';
}

const SCOPE_HINTS = new Map<McpScope, string>([
  ['global', 'Added by someone here and approved for the whole workspace.'],
  ['personal', 'Added by one person — only they can see it.'],
  ['built-in', 'Ships with Xyne. Everyone can see it, though it may still need a key.'],
  ['unknown', 'This connector has no publish scope recorded.'],
]);

export function scopeHint(scope: McpScope): string {
  return SCOPE_HINTS.get(scope) ?? 'This connector has no publish scope recorded.';
}

export function buildMcpCatalog(
  availableTools: AvailableTools | null,
  servers: readonly McpServer[],
): McpCatalogEntry[] {
  if (!availableTools) return [];
  const serverByType = new Map(servers.map(server => [server.type, server]));
  const shared = sharedMcpToolNames(availableTools.integrations);

  return availableTools.integrations
    .filter(integration => integration.kind === 'mcp' || integration.kind === 'gateway')
    .map(integration => {
      const isGateway = integration.kind === 'gateway';
      const server = serverByType.get(integration.slug);
      const tools = [...integration.readTools, ...integration.writeTools];
      const sharedToolNames = isGateway
        ? undefined
        : new Set(tools.filter(tool => shared.has(tool.name)).map(tool => tool.name));
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
        scope: connectorScope(server),
        selectable: tools.length > 0,
        ...(sharedToolNames?.size ? { sharedToolNames } : {}),
      };
    });
}

export function toolSelectionKey(entry: McpCatalogEntry, tool: IntegrationToolEntry): string {
  if (entry.isGateway) return tool.slug;
  return entry.sharedToolNames?.has(tool.name) ? scopedToolKey(entry.slug, tool.name) : tool.name;
}

/**
 * Agents saved before shared names carried their connector hold the bare name.
 * It belongs to a connector that has another of its own tools picked: an
 * agent with GitHub on still shows GitHub, and Bitbucket stays off.
 */
function ownsBareSharedName(selection: ToolboxSelection, entry: McpCatalogEntry): boolean {
  return entry.tools.some(
    tool => !entry.sharedToolNames?.has(tool.name) && selection.direct.includes(tool.name),
  );
}

/**
 * Rewrites bare shared names as their owners' keys before a change, so
 * turning one connector off doesn't take the tool from another. Names no
 * connector owns stay as they are.
 */
function scopeBareSharedNames(
  catalog: readonly McpCatalogEntry[],
  selection: McpSelection,
): McpSelection {
  const owners = new Map<string, string[]>();
  for (const entry of catalog) {
    if (entry.isGateway || !entry.sharedToolNames?.size) continue;
    if (!ownsBareSharedName(selection, entry)) continue;
    for (const name of entry.sharedToolNames) {
      if (!selection.direct.includes(name)) continue;
      owners.set(name, [...(owners.get(name) ?? []), scopedToolKey(entry.slug, name)]);
    }
  }
  if (owners.size === 0) return selection;
  const direct = selection.direct.flatMap(key => owners.get(key) ?? [key]);
  return { ...selection, direct: [...new Set(direct)] };
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
  if (
    entry.sharedToolNames?.has(tool.name) &&
    selection.direct.includes(tool.name) &&
    ownsBareSharedName(selection, entry)
  ) {
    return true;
  }
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
    const scoped = scopeBareSharedNames(catalog, base);
    const touched = new Set(tools.map(tool => toolSelectionKey(entry, tool)));
    const rest = scoped.direct.filter(key => !touched.has(key));
    return { ...scoped, direct: next ? [...rest, ...touched] : rest };
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
