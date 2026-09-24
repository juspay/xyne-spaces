/**
 * Catalog-grounded Hub tool selection — same grounding channel/DM propose-agent
 * uses (`list_available_tools` / suggest-tools + resolve against org catalog).
 * Does not call propose-agent or mount agentSlug xyne.
 */

import { parseGatewaySource } from '@/components/ClawAgents/gatewayKeys';
import {
  buildMcpCatalog,
  enableEntry,
  type McpCatalogEntry,
} from '@/routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';
import type {
  AgentToolboxSelection,
  AvailableTools,
  ToolSuggestion,
} from '@/services/claw/clawToolsTypes';
import { toolboxFromSuggestion } from './toolboxFromSuggestion.ts';

const PRODUCT_ALIASES: ReadonlyArray<{ re: RegExp; needles: readonly string[] }> = [
  { re: /\bslack\b/i, needles: ['slack'] },
  { re: /\bgithub\b|\bgh\b/i, needles: ['github', 'gh'] },
  { re: /\bjira\b/i, needles: ['jira'] },
  { re: /\bnotion\b/i, needles: ['notion'] },
  { re: /\blinear\b/i, needles: ['linear'] },
  { re: /\bgmail\b/i, needles: ['gmail', 'google-mail'] },
  { re: /\boutlook\b/i, needles: ['outlook', 'microsoft'] },
  { re: /\bdiscord\b/i, needles: ['discord'] },
  { re: /\bteams\b/i, needles: ['teams', 'microsoft-teams'] },
  { re: /\bcalendar\b/i, needles: ['calendar', 'google-calendar'] },
  { re: /\bx\.com\b|\btwitter\b/i, needles: ['twitter', 'x.com', 'x-'] },
  { re: /\bconfluence\b/i, needles: ['confluence'] },
];

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function entryMatchesNeedles(entry: McpCatalogEntry, needles: readonly string[]): boolean {
  const hay = normalizeToken(`${entry.slug} ${entry.label}`);
  return needles.some(needle => hay.includes(normalizeToken(needle)));
}

/** Match named products in the utterance to org MCP/gateway catalog rows. */
export function matchNamedMcpEntries(
  intent: string,
  catalog: AvailableTools,
): McpCatalogEntry[] {
  const mcpCatalog = buildMcpCatalog(catalog, []);
  const matched: McpCatalogEntry[] = [];
  const seen = new Set<string>();
  for (const alias of PRODUCT_ALIASES) {
    if (!alias.re.test(intent)) continue;
    for (const entry of mcpCatalog) {
      if (!entry.selectable || seen.has(entry.slug)) continue;
      if (!entryMatchesNeedles(entry, alias.needles)) continue;
      seen.add(entry.slug);
      matched.push(entry);
    }
  }
  // Free-form: "… MCP" / "… integration" after a word that matches a label/slug.
  const named =
    intent.match(
      /\b(?:add|use|pick|choose|select|enable|attach)\s+(?:the\s+)?([a-z0-9][\w.-]{1,40})\s+(?:mcp|integration|server|tool)\b/i,
    ) ?? intent.match(/\b([a-z0-9][\w.-]{1,40})\s+mcp\b/i);
  const token = named?.[1]?.trim();
  if (token && !/^(an?|the|one|useful|some|any)$/i.test(token)) {
    const needle = normalizeToken(token);
    for (const entry of mcpCatalog) {
      if (!entry.selectable || seen.has(entry.slug)) continue;
      if (!normalizeToken(`${entry.slug} ${entry.label}`).includes(needle)) continue;
      seen.add(entry.slug);
      matched.push(entry);
    }
  }
  return matched;
}

/**
 * Resolve suggest-tools + named-product matches into a toolbox selection.
 * Prefer explicit name matches over a blind first-gateway fallback.
 */
export function selectionFromCatalogSuggestion(args: {
  current: AgentToolboxSelection;
  suggestion: ToolSuggestion;
  catalog: AvailableTools;
  intent: string;
}): AgentToolboxSelection {
  const { current, suggestion, catalog, intent } = args;
  let selection = toolboxFromSuggestion(current, suggestion, catalog);
  const named = matchNamedMcpEntries(intent, catalog);
  if (named.length > 0) {
    const mcpCatalog = buildMcpCatalog(catalog, []);
    for (const entry of named) {
      selection = {
        ...enableEntry(mcpCatalog, selection, entry),
        callableAgents: selection.callableAgents ?? [],
      };
    }
    return selection;
  }
  // Suggestion already bound real ids — keep it. Only if still empty, prefer
  // a selectable gateway that appears in the suggestion, else first selectable.
  const beforeEmpty =
    selection.direct.length === 0 &&
    selection.custom.length === 0 &&
    (selection.gateway?.length ?? 0) === 0 &&
    selection.subagents.length === 0;
  if (!beforeEmpty) return selection;

  const mcpCatalog = buildMcpCatalog(catalog, []);
  const suggestedSlugs = new Set((suggestion.integrations ?? []).map(row => row.slug));
  const pick =
    mcpCatalog.find(entry => suggestedSlugs.has(entry.slug) && entry.selectable) ??
    mcpCatalog.find(entry => entry.isGateway && entry.selectable) ??
    mcpCatalog.find(entry => entry.selectable);
  if (!pick) return selection;
  return {
    ...enableEntry(mcpCatalog, selection, pick),
    callableAgents: selection.callableAgents ?? [],
  };
}

/** Human labels for selected hubs — fed into generate-prompt after hubs land. */
export function describeSelectedTools(
  selection: AgentToolboxSelection,
  catalog: AvailableTools | null,
): string[] {
  const labels: string[] = [];
  if (!catalog) {
    return [
      ...selection.subagents,
      ...selection.direct,
      ...(selection.gateway ?? []),
      ...selection.custom,
    ];
  }
  for (const name of selection.subagents) labels.push(`subagent:${name}`);
  for (const integration of catalog.integrations) {
    if (integration.kind === 'gateway') {
      const service = parseGatewaySource(integration.slug)?.serviceName;
      if (service && (selection.gateway ?? []).includes(service)) {
        labels.push(integration.label || service);
      }
      continue;
    }
    const toolNames = new Set([
      ...integration.readTools.map(t => t.name),
      ...integration.writeTools.map(t => t.name),
    ]);
    const hit = selection.direct.some(id => toolNames.has(id));
    if (hit) labels.push(integration.label || integration.slug);
  }
  for (const slug of selection.custom) labels.push(slug);
  return [...new Set(labels)];
}

/**
 * Shared Hub catalog select: suggest-tools (catalog-grounded LLM) + named
 * product resolve against `getAvailableTools` (same catalog list_available_tools
 * exposes). Returns null when catalog cannot be loaded.
 */
export async function selectHubToolsForIntent(args: {
  intent: string;
  current: AgentToolboxSelection;
  systemPrompt?: string | undefined;
  catalog?: AvailableTools | null;
}): Promise<{
  selection: AgentToolboxSelection;
  catalog: AvailableTools;
  labels: string[];
} | null> {
  const { getAvailableTools, suggestTools } = await import('@/services/claw/clawToolsService');
  const catalog = args.catalog ?? (await getAvailableTools().catch(() => null));
  if (!catalog) return null;
  const suggestion = await suggestTools({
    description: args.intent,
    ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
  }).catch(
    (): ToolSuggestion => ({
      subagents: [],
      integrations: [],
      reasoning: {},
    }),
  );
  const selection = selectionFromCatalogSuggestion({
    current: args.current,
    suggestion,
    catalog,
    intent: args.intent,
  });
  return {
    selection,
    catalog,
    labels: describeSelectedTools(selection, catalog),
  };
}
