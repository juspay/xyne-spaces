import type { KbCollectionNode } from '@/services/claw/clawKnowledgeBaseTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
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

function matchExactSlug(name: string, catalogs: Catalogs): ToolMatch | null {
  const builtin = catalogs.builtinTools.find(tool => tool.slug === name);
  if (builtin) return { kind: 'builtin', tool: builtin };

  for (const entry of catalogs.mcpEntries) {
    const tool = entry.tools.find(t => t.slug === name);
    if (tool) return { kind: 'mcp', entry, tool };
  }
  return null;
}

function matchTool(raw: string, catalogs: Catalogs): ToolMatch {
  if (catalogs.subagentNames.has(raw)) return { kind: 'subagent', name: raw };

  const exact = matchExactSlug(raw, catalogs);
  if (exact) return exact;

  const bare = bareToolSlug(raw);
  if (catalogs.subagentNames.has(bare)) return { kind: 'subagent', name: bare };

  const bareExact = matchExactSlug(bare, catalogs);
  if (bareExact) return bareExact;

  for (const entry of catalogs.mcpEntries) {
    const tool = entry.tools.find(t => t.name === bare);
    if (tool) return { kind: 'mcp', entry, tool };
  }

  return { kind: 'unknown', name: raw };
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

function normalizeMcpKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[-_\s]+/g, ' ');
}

function mcpKeyTails(entry: McpCatalogEntry): string[] {
  const tails = new Set<string>();
  for (const source of [entry.slug, entry.label]) {
    const words = normalizeMcpKey(source).split(' ').filter(Boolean);
    if (words.length > 1) tails.add(words.slice(1).join(' '));
  }
  return [...tails];
}

function expandMcpNames(
  names: readonly string[],
  entries: readonly McpCatalogEntry[],
): {
  matches: { entry: McpCatalogEntry; tool: IntegrationToolEntry }[];
  unknown: string[];
} {
  const byKey = new Map<string, McpCatalogEntry>();
  const addKey = (key: string, entry: McpCatalogEntry): void => {
    if (key && !byKey.has(key)) byKey.set(key, entry);
  };
  for (const entry of entries) {
    addKey(normalizeMcpKey(entry.slug), entry);
    addKey(normalizeMcpKey(entry.label), entry);
  }
  const tailCounts = new Map<string, number>();
  for (const entry of entries) {
    for (const tail of mcpKeyTails(entry)) {
      tailCounts.set(tail, (tailCounts.get(tail) ?? 0) + 1);
    }
  }
  for (const entry of entries) {
    for (const tail of mcpKeyTails(entry)) {
      if (tailCounts.get(tail) === 1) addKey(tail, entry);
    }
  }

  const matches: { entry: McpCatalogEntry; tool: IntegrationToolEntry }[] = [];
  const unknown: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const entry = byKey.get(normalizeMcpKey(name));
    if (!entry) {
      if (!unknown.includes(name)) unknown.push(name);
      continue;
    }
    if (seen.has(entry.slug)) continue;
    seen.add(entry.slug);
    for (const tool of entry.tools) matches.push({ entry, tool });
  }
  return { matches, unknown };
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
  const expandedMcps = expandMcpNames(mcpNames, catalogs.mcpEntries);
  const unknown: string[] = [...expandedMcps.unknown];

  for (const { entry, tool } of expandedMcps.matches) {
    tools = keepCallableAgents(
      selectMcpTools(catalogs.mcpEntries, tools, entry, [tool], true),
      tools,
    );
  }

  for (const raw of names) {
    const match = matchTool(raw, catalogs);

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

  const granted = new Set(grantedNames(tools));
  const removed = grantedNames(current).filter(name => !granted.has(name));

  return { status: 'resolved', tools, unknown, removed };
}

const FIELDS_THIS_DRAFT_CANNOT_SET = ['modelId', 'scope', 'memory'] as const;

export interface DraftPatch {
  patch: Partial<WizardState>;
  problems: string[];
}

export interface DraftPatchContext {
  toolsIntent?: 'replace' | 'merge';
  anchorPrompt?: string;
  skillCatalog?: readonly Skill[];
  kbCollections?: readonly KbCollectionNode[];
}

function resolveByName<T>(
  names: readonly string[],
  items: readonly T[],
  keysOf: (item: T) => (string | undefined)[],
  idOf: (item: T) => string,
): { ids: string[]; unknown: string[] } {
  const byKey = new Map<string, string>();
  for (const item of items) {
    for (const key of keysOf(item)) {
      const normalized = key?.trim().toLowerCase();
      if (normalized && !byKey.has(normalized)) byKey.set(normalized, idOf(item));
    }
  }
  const ids: string[] = [];
  const unknown: string[] = [];
  for (const name of names) {
    const id = byKey.get(name.trim().toLowerCase());
    if (id === undefined) unknown.push(name);
    else if (!ids.includes(id)) ids.push(id);
  }
  return { ids, unknown };
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function onlyStrings(value: unknown[]): string[] {
  return value.filter((entry): entry is string => typeof entry === 'string');
}

function stringList(value: unknown): string[] | null {
  if (Array.isArray(value)) return onlyStrings(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (!trimmed.startsWith('[')) return [trimmed];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) ? onlyStrings(parsed) : null;
  } catch {
    return null;
  }
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

  const proposedTools = stringList(params['tools']);
  const proposedMcps = stringList(params['mcps']);
  if (proposedTools !== null || proposedMcps !== null) {
    const replaces = context.toolsIntent !== 'merge' && proposedTools !== null;
    const kept = replaces ? [] : grantedNames(draft.tools);
    const names = [...kept, ...(proposedTools ?? [])];
    const resolved = resolveProposedTools(names, catalog, draft.tools, proposedMcps ?? []);

    if (resolved.status === 'catalog-unavailable') {
      problems.push('Tools not applied — the tool catalogue is still loading. Try again.');
    } else if (resolved.status === 'resolved') {
      patch.tools = resolved.tools;
      if (resolved.unknown.length > 0) {
        problems.push(`Not added — no such capability here: ${resolved.unknown.join(', ')}.`);
      }
    }
  }

  const proposedSkills = stringList(params['skills']);
  if (proposedSkills !== null) {
    if (!context.skillCatalog) {
      problems.push('Skills not applied — the skill list is still loading. Try again.');
    } else {
      const { ids, unknown } = resolveByName(
        proposedSkills,
        context.skillCatalog,
        skill => [skill.id, skill.slug, skill.name, skill.label],
        skill => skill.id,
      );
      patch.selectedSkillIds = ids;
      if (unknown.length > 0) {
        problems.push(`Skills not added — no such skill here: ${unknown.join(', ')}.`);
      }
    }
  }

  const knowledge = params['knowledge'];
  if (knowledge && typeof knowledge === 'object') {
    const scope = text((knowledge as Record<string, unknown>)['scope']);
    if (scope === 'USER' || scope === 'COLLECTIONS') patch.selectedKbScope = scope;

    const names = stringList((knowledge as Record<string, unknown>)['collections']);
    if (names !== null) {
      if (!context.kbCollections) {
        problems.push('Knowledge not applied — the collection list is still loading. Try again.');
      } else {
        const { ids, unknown } = resolveByName(
          names,
          context.kbCollections,
          node => [node.id, node.name],
          node => node.id,
        );
        patch.selectedKbResources = ids.map(id => ({ collectionId: id, fileId: null }));
        if (ids.length > 0) patch.selectedKbScope = 'COLLECTIONS';
        if (unknown.length > 0) {
          problems.push(`Knowledge not added — no such collection here: ${unknown.join(', ')}.`);
        }
      }
    }
  }

  const unsettable = FIELDS_THIS_DRAFT_CANNOT_SET.filter(field => params[field] !== undefined);
  if (unsettable.length > 0) {
    problems.push(`Not applied — this draft cannot set: ${unsettable.join(', ')}.`);
  }

  return { patch, problems };
}
