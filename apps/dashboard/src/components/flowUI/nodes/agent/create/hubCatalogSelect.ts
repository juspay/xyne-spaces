/**
 * Catalog-grounded Hub tool selection — same grounding channel/DM propose-agent
 * uses (`list_available_tools` / suggest-tools + resolve against org catalog).
 * Does not call propose-agent or mount agentSlug xyne.
 *
 * Precision over recall for MCP: only bind products clearly implicated by the
 * job (named / soft cues), never spray messaging MCPs like Slack for Spaces DM.
 */

import { parseGatewaySource } from '@/components/ClawAgents/gatewayKeys';
import {
  buildBuiltinCatalog,
  enableEntry as enableBuiltinEntry,
  type BuiltinCatalogEntry,
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
import {
  intentImpliesBuiltin as jobImpliesBuiltin,
  intentImpliesSubagent as jobImpliesSubagent,
  softBuiltinCuesForIntent,
  softProductNeedles,
  SOFT_PRODUCT_CUES,
} from './capabilityInference.ts';

const PRODUCT_ALIASES: ReadonlyArray<{ re: RegExp; needles: readonly string[] }> = [
  { re: /\bslack\b/i, needles: ['slack'] },
  { re: /\bgithub\b|\bgh\b/i, needles: ['github', 'gh'] },
  { re: /\bjira\b/i, needles: ['jira'] },
  { re: /\bnotion\b/i, needles: ['notion'] },
  { re: /\blinear\b/i, needles: ['linear'] },
  { re: /\bgmail\b/i, needles: ['gmail', 'google-mail'] },
  { re: /\boutlook\b/i, needles: ['outlook', 'microsoft'] },
  // Bare "email(s)" → builtin path; Gmail/Outlook MCP only when those are named.
  { re: /\bdiscord\b/i, needles: ['discord'] },
  { re: /\bteams\b/i, needles: ['teams', 'microsoft-teams'] },
  { re: /\bcalendar\b/i, needles: ['calendar', 'google-calendar'] },
  // No bare "x-" needle — normalizeToken("x-") === "x" matched Xyne Spaces.
  { re: /\bx\.com\b|\btwitter\b/i, needles: ['twitter', 'x.com'] },
  {
    re: /\b(xyne\s*spaces|spaces?\s*dms?|\bin\s+spaces\b)\b/i,
    needles: ['spaces', 'xyne-spaces', 'xyne spaces', 'xyne-spaces-app'],
  },
  { re: /\bconfluence\b/i, needles: ['confluence'] },
];

const MIN_NEEDLE_LEN = 3;

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/** True when entry is the X / Twitter MCP product (not Xyne*). */
function entryIsXProduct(entry: McpCatalogEntry): boolean {
  const label = entry.label.trim();
  const slug = entry.slug.toLowerCase();
  if (/xyne/i.test(label) || /xyne/.test(slug)) return false;
  if (/\btwitter\b/i.test(label) || slug.includes('twitter')) return true;
  if (/^x\b/i.test(label) || /^\(?\s*x\s*\)/i.test(label)) return true;
  if (slug === 'x' || slug.startsWith('x-') || /^x[^a-z]/.test(slug)) return true;
  return false;
}

function entryMatchesNeedles(entry: McpCatalogEntry, needles: readonly string[]): boolean {
  const hay = normalizeToken(`${entry.slug} ${entry.label}`);
  return needles.some(needle => {
    const n = normalizeToken(needle);
    if (!n) return false;
    // Reject over-broad single/double-char needles (e.g. "x" from "x-").
    if (n.length < MIN_NEEDLE_LEN) {
      if (n === 'x' || n === 'gh') {
        return n === 'x' ? entryIsXProduct(entry) : hay.includes(n);
      }
      return false;
    }
    // "spaces" must not match unrelated *spaces* substrings inside other brands
    // except Xyne Spaces / spaces-* hubs.
    if (n === 'spaces') {
      return (
        hay.includes('xynespaces') ||
        hay.startsWith('spaces') ||
        /\bspaces\b/i.test(entry.label) ||
        entry.slug.toLowerCase().includes('spaces')
      );
    }
    return hay.includes(n);
  });
}

/** Match named + soft job-cue products in the utterance to org MCP/gateway rows. */
export function matchNamedMcpEntries(
  intent: string,
  catalog: AvailableTools,
): McpCatalogEntry[] {
  const mcpCatalog = buildMcpCatalog(catalog, []);
  const matched: McpCatalogEntry[] = [];
  const seen = new Set<string>();

  const pushNeedles = (needles: readonly string[]): void => {
    for (const entry of mcpCatalog) {
      if (!entry.selectable || seen.has(entry.slug)) continue;
      if (!entryMatchesNeedles(entry, needles)) continue;
      seen.add(entry.slug);
      matched.push(entry);
    }
  };

  for (const alias of PRODUCT_ALIASES) {
    if (!alias.re.test(intent)) continue;
    pushNeedles(alias.needles);
  }
  // Soft cues: standup → Slack, Spaces DM → Spaces, X.com → X (not Xyne via "x").
  for (const cue of SOFT_PRODUCT_CUES) {
    if (!cue.re.test(intent)) continue;
    pushNeedles(cue.needles);
  }
  const soft = softProductNeedles(intent);
  if (soft.length > 0) pushNeedles(soft);

  // X.com / Twitter → bind X product rows even when needle length guards apply.
  if (/\bx\.com\b|\btwitter\b|\btweets?\b/i.test(intent)) {
    for (const entry of mcpCatalog) {
      if (!entry.selectable || seen.has(entry.slug)) continue;
      if (!entryIsXProduct(entry)) continue;
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
    if (needle.length >= MIN_NEEDLE_LEN || needle === 'x') {
      for (const entry of mcpCatalog) {
        if (!entry.selectable || seen.has(entry.slug)) continue;
        if (needle === 'x') {
          if (!entryIsXProduct(entry)) continue;
        } else if (!normalizeToken(`${entry.slug} ${entry.label}`).includes(needle)) {
          continue;
        }
        seen.add(entry.slug);
        matched.push(entry);
      }
    }
  }
  return matched;
}

/** True when the utterance names a product or soft-cues one we try to bind. */
export function intentNamesProduct(intent: string): boolean {
  if (PRODUCT_ALIASES.some(alias => alias.re.test(intent))) return true;
  if (softProductNeedles(intent).length > 0) return true;
  return Boolean(
    intent.match(
      /\b(?:add|use|pick|choose|select|enable|attach)\s+(?:the\s+)?([a-z0-9][\w.-]{1,40})\s+(?:mcp|integration|server|tool)\b/i,
    ) ?? intent.match(/\b([a-z0-9][\w.-]{1,40})\s+mcp\b/i),
  );
}

/** User asked for / job implies a subagent / delegate (not only MCP). */
export function intentImpliesSubagent(intent: string): boolean {
  return jobImpliesSubagent(intent);
}

/** User asked for / job implies built-in search / browse / email / DM tools. */
export function intentImpliesBuiltin(intent: string): boolean {
  return jobImpliesBuiltin(intent) || /\b(search|code)\s+tools?\b/i.test(intent);
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

function scoreBuiltinAgainstNeedles(
  entry: BuiltinCatalogEntry,
  needles: readonly string[],
): number {
  const hay = normalizeToken(
    `${entry.label} ${entry.source} ${entry.tools.map(t => `${t.slug} ${t.name}`).join(' ')}`,
  );
  let score = 0;
  for (const needle of needles) {
    const n = normalizeToken(needle);
    if (n.length >= 2 && hay.includes(n)) score += n.length;
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
  // Precision: do not spray the first subagent when nothing scores.
  return [];
}

/**
 * Enable builtin catalog rows that match email / DM / web job categories.
 * One best entry per active cue category — never spray every custom:* row.
 */
export function pickBuiltinSelectionForIntent(
  intent: string,
  catalog: AvailableTools,
  current: AgentToolboxSelection,
): AgentToolboxSelection {
  if (!intentImpliesBuiltin(intent)) return current;
  const builtins = buildBuiltinCatalog(catalog);
  if (builtins.length === 0) return current;

  let selection = {
    ...current,
    callableAgents: current.callableAgents ?? [],
  };

  const cues = softBuiltinCuesForIntent(intent);
  const pickedSources = new Set<string>();

  for (const cue of cues) {
    const ranked = builtins
      .filter(entry => {
        if (pickedSources.has(entry.source)) return false;
        const hay = `${entry.label} ${entry.source} ${entry.tools.map(t => `${t.slug} ${t.name}`).join(' ')}`;
        return cue.entryRe.test(hay);
      })
      .map(entry => ({
        entry,
        score: scoreBuiltinAgainstNeedles(entry, cue.needles),
      }))
      .filter(row => row.score > 0)
      .sort((a, b) => b.score - a.score);

    const best = ranked[0];
    if (!best) continue;
    pickedSources.add(best.entry.source);
    selection = {
      ...enableBuiltinEntry(selection, best.entry),
      callableAgents: selection.callableAgents ?? [],
    };
  }

  if (pickedSources.size > 0) return selection;

  // Fallback for generic web-research with no category hit: web/browse/search only.
  if (/\b(web\s*search|browse|on\s+the\s+web|web\s+research|researches?\b)\b/i.test(intent)) {
    const pick =
      builtins.find(entry =>
        /web[-_\s]?search|webfetch|browse|research\s*agent/i.test(`${entry.label} ${entry.source}`),
      ) ?? null;
    if (pick) {
      return {
        ...enableBuiltinEntry(selection, pick),
        callableAgents: selection.callableAgents ?? [],
      };
    }
  }
  return selection;
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
    // Keep suggest-tools ids only when they also match named/soft needles —
    // do not let suggest spray Slack onto an X + Spaces job.
    return filterSuggestionToRelevant(selection, named, intent, catalog);
  }
  // Hard-named product in utterance but nothing in catalog → leave empty (honest miss).
  // Soft job cues alone still keep suggest-tools ids when present.
  const hardNamed = PRODUCT_ALIASES.some(alias => alias.re.test(intent));
  if (hardNamed && intentNamesProduct(intent)) {
    return {
      ...current,
      callableAgents: current.callableAgents ?? [],
    };
  }
  // Suggestion already bound real ids — keep it, but drop chat MCPs irrelevant
  // to an X / Spaces / email job.
  return filterIrrelevantChatMcps(selection, intent, catalog);
}

/** Drop suggest-tools MCP rows that don't overlap named matches when we have them. */
function filterSuggestionToRelevant(
  selection: AgentToolboxSelection,
  named: McpCatalogEntry[],
  intent: string,
  catalog: AvailableTools,
): AgentToolboxSelection {
  const namedToolIds = new Set<string>();
  for (const entry of named) {
    for (const tool of entry.tools) {
      namedToolIds.add(tool.slug);
      namedToolIds.add(tool.name);
    }
  }
  const soft = softProductNeedles(intent);
  const mcpCatalog = buildMcpCatalog(catalog, []);
  const softSlugs = new Set(
    mcpCatalog
      .filter(entry => soft.length > 0 && entryMatchesNeedles(entry, soft))
      .map(entry => entry.slug),
  );
  const allowedDirect = selection.direct.filter(id => {
    if (namedToolIds.has(id)) return true;
    for (const entry of mcpCatalog) {
      if (!softSlugs.has(entry.slug)) continue;
      if (entry.tools.some(t => t.slug === id || t.name === id)) return true;
    }
    return false;
  });
  // If filtering emptied MCP while named exists, re-enable named only.
  if (allowedDirect.length === 0 && named.length > 0) {
    let next: AgentToolboxSelection = {
      ...selection,
      direct: [],
      gateway: selection.gateway ?? [],
    };
    for (const entry of named) {
      next = {
        ...enableEntry(mcpCatalog, next, entry),
        callableAgents: next.callableAgents ?? [],
      };
    }
    return next;
  }
  return { ...selection, direct: allowedDirect };
}

/** When job is Spaces/X/email and Slack wasn't named, strip Slack from suggestion. */
function filterIrrelevantChatMcps(
  selection: AgentToolboxSelection,
  intent: string,
  catalog: AvailableTools,
): AgentToolboxSelection {
  if (/\bslack\b/i.test(intent)) return selection;
  const spacesOrX =
    /\b(xyne\s*spaces|spaces?\s*dms?|x\.com|twitter)\b/i.test(intent) ||
    softProductNeedles(intent).some(n => /spaces|twitter|x\.com/i.test(n));
  if (!spacesOrX) return selection;

  const mcpCatalog = buildMcpCatalog(catalog, []);
  const slackToolIds = new Set<string>();
  for (const entry of mcpCatalog) {
    if (!/slack/i.test(`${entry.slug} ${entry.label}`)) continue;
    for (const tool of entry.tools) {
      slackToolIds.add(tool.slug);
      slackToolIds.add(tool.name);
    }
  }
  if (slackToolIds.size === 0) return selection;
  return {
    ...selection,
    direct: selection.direct.filter(id => !slackToolIds.has(id)),
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
 * Shared Hub catalog select: prefer named / soft-cue product resolve against
 * `getAvailableTools`. Always apply local subagent / builtin binds when the
 * job implies them. Call suggest-tools when local binds leave needed hubs empty.
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

  // Named/soft MCP + local subagent/builtin picks first — do not wait on suggest-tools.
  let selection = applyLocalHubBinds(args.intent, catalog, args.current);
  const named = matchNamedMcpEntries(args.intent, catalog);

  const needsSuggest =
    !selectionHasTools(selection) ||
    (jobImpliesBuiltin(args.intent) && selection.custom.length === 0) ||
    (jobImpliesSubagent(args.intent) && selection.subagents.length === 0) ||
    (named.length === 0 && softProductNeedles(args.intent).length > 0 &&
      selection.direct.length === 0 &&
      (selection.gateway ?? []).length === 0);

  if (needsSuggest) {
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
  }

  // Strip Slack when job is Spaces/X and Slack wasn't named (suggest residual).
  selection = filterIrrelevantChatMcps(selection, args.intent, catalog);

  // Hard-named product with no catalog match and no other binds → empty.
  const hardNamed = PRODUCT_ALIASES.some(alias => alias.re.test(args.intent));
  if (
    hardNamed &&
    named.length === 0 &&
    !selectionHasTools(selection)
  ) {
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
