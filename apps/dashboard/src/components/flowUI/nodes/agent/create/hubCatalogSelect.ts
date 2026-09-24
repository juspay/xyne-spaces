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

/** True when the utterance names a product we try to bind (Slack, GitHub, …). */
export function intentNamesProduct(intent: string): boolean {
  if (PRODUCT_ALIASES.some(alias => alias.re.test(intent))) return true;
  return Boolean(
    intent.match(
      /\b(?:add|use|pick|choose|select|enable|attach)\s+(?:the\s+)?([a-z0-9][\w.-]{1,40})\s+(?:mcp|integration|server|tool)\b/i,
    ) ?? intent.match(/\b([a-z0-9][\w.-]{1,40})\s+mcp\b/i),
  );
}

/**
 * Resolve suggest-tools + named-product matches into a toolbox selection.
 * Prefer explicit name matches. Never bind a blind first-gateway / first
 * selectable row — that produced fake “email / X” hub fills.
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
  // Named product in utterance but nothing in catalog → leave empty (honest miss).
  if (intentNamesProduct(intent)) {
    return {
      ...current,
      callableAgents: current.callableAgents ?? [],
    };
  }
  // Suggestion already bound real ids — keep it. No first-gateway fallback.
  return selection;
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

const CATALOG_MS = 4_000;
const SUGGEST_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

/**
 * Shared Hub catalog select: prefer named product resolve against
 * `getAvailableTools` (same catalog list_available_tools exposes). Only call
 * suggest-tools when no named product matched — suggest hangs often.
 * Returns null when catalog cannot be loaded.
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
  const catalog =
    args.catalog ??
    (await withTimeout(getAvailableTools(), CATALOG_MS, 'getAvailableTools').catch(() => null));
  if (!catalog) return null;

  // Named products first — do not wait on suggest-tools for Slack/GitHub.
  const named = matchNamedMcpEntries(args.intent, catalog);
  if (named.length > 0) {
    const mcpCatalog = buildMcpCatalog(catalog, []);
    let selection: AgentToolboxSelection = {
      ...args.current,
      callableAgents: args.current.callableAgents ?? [],
    };
    for (const entry of named) {
      selection = {
        ...enableEntry(mcpCatalog, selection, entry),
        callableAgents: selection.callableAgents ?? [],
      };
    }
    return {
      selection,
      catalog,
      labels: describeSelectedTools(selection, catalog),
    };
  }

  const suggestion = await withTimeout(
    suggestTools({
      description: args.intent,
      ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
    }),
    SUGGEST_MS,
    'suggestTools',
  ).catch(
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
