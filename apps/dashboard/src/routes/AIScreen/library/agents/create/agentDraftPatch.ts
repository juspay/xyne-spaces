import type { AvailableTools, IntegrationToolEntry } from '@/services/claw/clawToolsTypes';
import { slugify, type WizardState } from '../../../../ClawAgentsScreen/create/wizardState';
import { resolvePromptChange } from './promptEdits';
import {
  buildBuiltinCatalog,
  setToolsSelected as selectBuiltinTools,
} from '../../shared/pickers/builtin/builtinCatalog';
import {
  buildMcpCatalog,
  setToolsSelected as selectMcpTools,
  type McpCatalogEntry,
} from '../../shared/pickers/mcp/mcpCatalog';

type ToolSelection = WizardState['tools'];

export type ResolvedTools =
  | {
      status: 'resolved';
      tools: ToolSelection;
      unknown: string[];
      removed: string[];
      deduped: string[];
      trimmedSubagents: string[];
    }
  | { status: 'catalog-unavailable' }
  | { status: 'nothing-proposed' };

function grantedNames(tools: ToolSelection): string[] {
  return [...tools.subagents, ...tools.direct, ...tools.custom, ...tools.gateway];
}

export function bareToolSlug(raw: string): string {
  const withoutServer = raw.includes('__') ? raw.split('__').slice(1).join('__') : raw;
  return withoutServer.split(':').pop() ?? withoutServer;
}

type ToolMatch =
  | { kind: 'subagent'; name: string }
  | { kind: 'builtin'; tool: IntegrationToolEntry }
  | { kind: 'mcp'; entry: McpCatalogEntry; tool: IntegrationToolEntry }
  | { kind: 'unknown'; name: string };

interface Catalogs {
  subagentNames: ReadonlySet<string>;
  builtinTools: readonly IntegrationToolEntry[];
  mcpEntries: readonly McpCatalogEntry[];
}

function matchTool(name: string, catalogs: Catalogs): ToolMatch {
  if (catalogs.subagentNames.has(name)) return { kind: 'subagent', name };

  const builtin = catalogs.builtinTools.find(tool => tool.slug === name);
  if (builtin) return { kind: 'builtin', tool: builtin };

  for (const entry of catalogs.mcpEntries) {
    const tool = entry.tools.find(t => t.slug === name || t.name === name);
    if (tool) return { kind: 'mcp', entry, tool };
  }

  return { kind: 'unknown', name };
}

function keepCallableAgents(
  next: Omit<ToolSelection, 'callableAgents'>,
  previous: ToolSelection,
): ToolSelection {
  return { ...next, callableAgents: previous.callableAgents };
}

function addSubagent(tools: ToolSelection, name: string): ToolSelection {
  if (tools.subagents.includes(name)) return tools;
  return { ...tools, subagents: [...tools.subagents, name] };
}

/** Exported so the builder's prompt can state the real limit. A second copy of
 *  the number there would drift, and the agent would keep proposing what this
 *  silently drops. */
export const MAX_SUBAGENTS = 2;

interface JudgedSelection {
  tools: ToolSelection;
  deduped: string[];
  trimmedSubagents: string[];
}

function judgeSelection(
  tools: ToolSelection,
  catalog: AvailableTools,
  catalogs: Catalogs,
): JudgedSelection {
  const serverTypeOf = new Map(catalog.subagents.map(s => [s.name, s.serverType]));
  const coveredServers = new Set(
    tools.subagents.map(name => serverTypeOf.get(name)).filter((t): t is string => Boolean(t)),
  );

  const deduped: string[] = [];
  const direct = tools.direct.filter(slug => {
    const entry = catalogs.mcpEntries.find(e =>
      e.tools.some(t => t.slug === slug || t.name === slug),
    );
    const server = entry?.server?.type ?? entry?.slug;
    if (server && coveredServers.has(server)) {
      deduped.push(slug);
      return false;
    }
    return true;
  });

  const trimmedSubagents = tools.subagents.slice(MAX_SUBAGENTS);
  const subagents = tools.subagents.slice(0, MAX_SUBAGENTS);

  return { tools: { ...tools, subagents, direct }, deduped, trimmedSubagents };
}

/** Mirrors expandMcpRequests in xyne-claw-auth: an integration named by slug or
 *  label grants that integration's whole tool set. matchTool only knows tool
 *  slugs, so an integration name reaching it resolves to nothing — or worse, to
 *  the subagent that shares its name, which is how "add the Slack MCP" ended up
 *  granting the Slack subagent instead. */
function expandMcpNames(
  names: readonly string[],
  entries: readonly McpCatalogEntry[],
): { tools: string[]; unknown: string[] } {
  const byKey = new Map<string, McpCatalogEntry>();
  for (const entry of entries) {
    byKey.set(entry.slug.toLowerCase(), entry);
    byKey.set(entry.label.toLowerCase(), entry);
  }

  const tools: string[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const entry = byKey.get(name.trim().toLowerCase());
    if (!entry) {
      if (!unknown.includes(name)) unknown.push(name);
      continue;
    }
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    for (const tool of entry.tools) tools.push(tool.slug);
  }
  return { tools, unknown };
}

export function resolveProposedTools(
  names: readonly string[],
  catalog: AvailableTools | undefined,
  current: ToolSelection,
  mcpNames: readonly string[] = [],
): ResolvedTools {
  if (names.length === 0 && mcpNames.length === 0) return { status: 'nothing-proposed' };
  if (!catalog) return { status: 'catalog-unavailable' };

  const catalogs: Catalogs = {
    subagentNames: new Set(catalog.subagents.map(subagent => subagent.name)),
    builtinTools: buildBuiltinCatalog(catalog).flatMap(entry => entry.tools),
    mcpEntries: buildMcpCatalog(catalog, []),
  };

  let tools: ToolSelection = {
    subagents: [],
    direct: [],
    custom: [],
    gateway: [],
    callableAgents: current.callableAgents,
  };
  // Integrations resolve to their tool ids BEFORE the matcher sees them, so a
  // name that is also a subagent can no longer be mistaken for one.
  const expandedMcps = expandMcpNames(mcpNames, catalogs.mcpEntries);
  const unknown: string[] = [...expandedMcps.unknown];

  for (const raw of [...names, ...expandedMcps.tools]) {
    const match = matchTool(bareToolSlug(raw), catalogs);

    switch (match.kind) {
      case 'subagent':
        tools = addSubagent(tools, match.name);
        break;
      case 'builtin':
        tools = keepCallableAgents(selectBuiltinTools(tools, [match.tool], true), tools);
        break;
      case 'mcp':
        tools = keepCallableAgents(
          selectMcpTools(catalogs.mcpEntries, tools, match.entry, [match.tool], true),
          tools,
        );
        break;
      case 'unknown':
        unknown.push(match.name);
        break;
    }
  }

  const judged = judgeSelection(tools, catalog, catalogs);

  const granted = new Set(grantedNames(judged.tools));
  const removed = grantedNames(current).filter(name => !granted.has(name));

  return {
    status: 'resolved',
    tools: judged.tools,
    unknown,
    removed,
    deduped: judged.deduped,
    trimmedSubagents: judged.trimmedSubagents,
  };
}

const FIELDS_THIS_DRAFT_CANNOT_SET = ['modelId', 'skills', 'knowledge', 'scope', 'memory'] as const;

export interface DraftPatch {
  patch: Partial<WizardState>;
  problems: string[];
}

export interface DraftPatchContext {
  toolsIntent?: 'replace' | 'merge';
  anchorPrompt?: string;
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function paramsToDraftPatch(
  params: Record<string, unknown>,
  draft: WizardState,
  catalog: AvailableTools | undefined,
  context: DraftPatchContext = {},
): DraftPatch {
  const patch: Partial<WizardState> = {};
  const problems: string[] = [];

  const name = text(params['name']);
  if (name !== undefined) {
    patch.name = name;
    if (!draft.slugManual) patch.slug = slugify(name);
  }

  const slug = text(params['slug']);
  if (slug !== undefined) {
    patch.slug = slugify(slug);
    patch.slugManual = true;
  }

  const description = text(params['description']);
  if (description !== undefined) patch.description = description;

  const color = text(params['color']);
  if (color !== undefined) patch.color = color;

  const prompt = resolvePromptChange(params, context.anchorPrompt ?? draft.systemPrompt);
  if (prompt.error !== undefined) {
    problems.push(`Instructions not applied — ${prompt.error}`);
  } else if (prompt.prompt !== undefined) {
    patch.systemPrompt = prompt.prompt;
  }

  // `mcps` carries integrations asked for by name ("add the github MCP"); the
  // agent is told to keep those out of `tools`. They are resolved separately,
  // against the integration catalogue, so a name shared with a subagent can
  // only ever mean the integration here.
  const proposedTools = params['tools'];
  const proposedMcps = params['mcps'];
  if (Array.isArray(proposedTools) || Array.isArray(proposedMcps)) {
    const strings = (value: unknown): string[] =>
      Array.isArray(value)
        ? value.filter((entry): entry is string => typeof entry === 'string')
        : [];
    const replaces = context.toolsIntent !== 'merge' && Array.isArray(proposedTools);
    const kept = replaces ? [] : grantedNames(draft.tools);
    const names = [...kept, ...strings(proposedTools)];
    const resolved = resolveProposedTools(names, catalog, draft.tools, strings(proposedMcps));

    if (resolved.status === 'catalog-unavailable') {
      problems.push('Tools not applied — the tool catalogue is still loading. Try again.');
    } else if (resolved.status === 'resolved') {
      patch.tools = resolved.tools;
    }
  }

  const unsettable = FIELDS_THIS_DRAFT_CANNOT_SET.filter(field => params[field] !== undefined);
  if (unsettable.length > 0) {
    problems.push(`Not applied — this draft cannot set: ${unsettable.join(', ')}.`);
  }

  return { patch, problems };
}
