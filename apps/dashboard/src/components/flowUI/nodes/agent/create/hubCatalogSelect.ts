/**
 * Catalog-grounded Hub tool selection — same grounding channel/DM propose-agent
 * uses (`list_available_tools` / suggest-tools + resolve against org catalog).
 * Does not call propose-agent or mount agentSlug xyne.
 */

import { parseGatewaySource } from '@/components/ClawAgents/gatewayKeys';
import {
  buildBuiltinCatalog,
  enableEntry as enableBuiltinEntry,
} from '@/routes/AIScreen/library/shared/pickers/builtin/builtinCatalog';
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

/** User asked for a subagent / delegate (not only MCP). */
export function intentImpliesSubagent(intent: string): boolean {
  return /\b(sub-?agents?|delegate|delegat(?:e|ion))\b/i.test(intent);
}

/** User asked for built-in search / browse / filesystem tools. */
export function intentImpliesBuiltin(intent: string): boolean {
  return /\b(built-?ins?|browse|web\s*search|filesystem|terminal)\b/i.test(intent) ||
    /\b(search|code)\s+tools?\b/i.test(intent);
}

function scoreNameAgainstIntent(name: string, intent: string): number {
  const hay = normalizeToken(name);
  if (!hay) return 0;
  const tokens = intent
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(token => token.length >= 3 && !/^(the|and|for|with|that|this|from|into|use|add)$/.test(token));
  let score = 0;
  for (const token of tokens) {
    const needle = normalizeToken(token);
    if (needle && hay.includes(needle)) score += needle.length;
  }
  return score;
}

/** Pick catalog subagent names when the utterance asks for one. */
export function pickSubagentsForIntent(intent: string, catalog: AvailableTools): string[] {
  if (!intentImpliesSubagent(intent) || catalog.subagents.length === 0) return [];
  const ranked = [...catalog.subagents]
    .map(entry => ({ name: entry.name, score: scoreNameAgainstIntent(`${entry.name} ${entry.description}`, intent) }))
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (best && best.score > 0) return [best.name];
  return [catalog.subagents[0]!.name];
}

/** Enable builtin catalog rows when the utterance asks for built-ins. */
export function pickBuiltinSelectionForIntent(
  intent: string,
  catalog: AvailableTools,
  current: AgentToolboxSelection,
): AgentToolboxSelection {
  if (!intentImpliesBuiltin(intent)) return current;
  const builtins = buildBuiltinCatalog(catalog);
  if (builtins.length === 0) return current;
  const ranked = builtins
    .map(entry => ({
      entry,
      score: scoreNameAgainstIntent(`${entry.label} ${entry.source}`, intent),
    }))
    .sort((a, b) => b.score - a.score);
  const pick =
    ranked.find(row => row.score > 0)?.entry ??
    builtins.find(entry => /search|web|browse/i.test(`${entry.label} ${entry.source}`)) ??
    builtins.find(entry => entry.tools.length > 0);
  if (!pick) return current;
  return {
    ...enableBuiltinEntry(current, pick),
    callableAgents: current.callableAgents ?? [],
  };
}

/** Merge named MCP + local subagent/builtin picks onto a selection. */
export function applyLocalHubBinds(
  intent: string,
  catalog: AvailableTools,
  current: AgentToolboxSelection,
): AgentToolboxSelection {
  let selection: AgentToolboxSelection = {
    ...current,
    callableAgents: current.callableAgents ?? [],
  };
  const named = matchNamedMcpEntries(intent, catalog);
  if (named.length > 0) {
    const mcpCatalog = buildMcpCatalog(catalog, []);
    for (const entry of named) {
      selection = {
        ...enableEntry(mcpCatalog, selection, entry),
        callableAgents: selection.callableAgents ?? [],
      };
    }
  }
  const subagents = pickSubagentsForIntent(intent, catalog);
  if (subagents.length > 0) {
    selection = {
      ...selection,
      subagents: [...new Set([...selection.subagents, ...subagents])],
    };
  }
  selection = pickBuiltinSelectionForIntent(intent, catalog, selection);
  return selection;
}

function selectionHasTools(selection: AgentToolboxSelection): boolean {
  return (
    selection.subagents.length > 0 ||
    selection.direct.length > 0 ||
    selection.custom.length > 0 ||
    (selection.gateway ?? []).length > 0
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
      ...selection.subagents.map(name => `subagent:${name}`),
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
    if (integration.kind === 'builtin' || integration.kind === 'custom') continue;
    const toolNames = new Set([
      ...integration.readTools.map(t => t.name),
      ...integration.writeTools.map(t => t.name),
    ]);
    const hit = selection.direct.some(id => toolNames.has(id));
    if (hit) labels.push(integration.label || integration.slug);
  }
  const builtins = buildBuiltinCatalog(catalog);
  const coveredCustom = new Set<string>();
  for (const entry of builtins) {
    const hit = entry.tools.filter(tool => selection.custom.includes(tool.slug));
    if (hit.length === 0) continue;
    labels.push(`builtin:${entry.label || entry.source}`);
    for (const tool of hit) coveredCustom.add(tool.slug);
  }
  for (const slug of selection.custom) {
    if (coveredCustom.has(slug)) continue;
    labels.push(slug);
  }
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
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Shared Hub catalog select: prefer named product resolve against
 * `getAvailableTools` (same catalog list_available_tools exposes). Always apply
 * local subagent / builtin binds when the utterance asks for them — even when a
 * named MCP match short-circuits suggest-tools. Only call suggest-tools when no
 * named product matched and local binds left tools empty.
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

  // Named MCP + local subagent/builtin picks first — do not wait on suggest-tools.
  let selection = applyLocalHubBinds(args.intent, catalog, args.current);
  const named = matchNamedMcpEntries(args.intent, catalog);

  // Suggest only when no named product and we still lack tools (or need more
  // integration ids). Never drop already-bound local chips.
  if (named.length === 0 && !selectionHasTools(selection)) {
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
    selection = selectionFromCatalogSuggestion({
      current: selection,
      suggestion,
      catalog,
      intent: args.intent,
    });
    // Re-apply local binds so suggest cannot wipe subagent/builtin intent picks.
    selection = applyLocalHubBinds(args.intent, catalog, selection);
  } else if (named.length === 0) {
    // Local binds already filled something; optionally enrich via suggest without
    // blocking forever — skip to keep Hub snappy (named-MCP path already skips).
  }

  // Named product in utterance but nothing matched and no other binds → empty.
  if (named.length === 0 && intentNamesProduct(args.intent) && !selectionHasTools(selection)) {
    selection = {
      ...args.current,
      callableAgents: args.current.callableAgents ?? [],
    };
  }

  return {
    selection,
    catalog,
    labels: describeSelectedTools(selection, catalog),
  };
}
