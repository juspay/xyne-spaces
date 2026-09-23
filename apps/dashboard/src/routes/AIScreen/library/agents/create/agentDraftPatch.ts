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
  | { status: 'resolved'; tools: ToolSelection; unknown: string[]; removed: string[] }
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

export function resolveProposedTools(
  names: readonly string[],
  catalog: AvailableTools | undefined,
  current: ToolSelection,
): ResolvedTools {
  if (names.length === 0) return { status: 'nothing-proposed' };
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
  const unknown: string[] = [];

  for (const raw of names) {
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

  const granted = new Set(grantedNames(tools));
  const removed = grantedNames(current).filter(name => !granted.has(name));

  return { status: 'resolved', tools, unknown, removed };
}

const FIELDS_THIS_DRAFT_CANNOT_SET = [
  'modelId',
  'skills',
  'knowledge',
  'mcps',
  'scope',
  'memory',
] as const;

export interface DraftPatch {
  patch: Partial<WizardState>;
  problems: string[];
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

export function paramsToDraftPatch(
  params: Record<string, unknown>,
  draft: WizardState,
  catalog: AvailableTools | undefined,
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

  const prompt = resolvePromptChange(params, draft.systemPrompt);
  if (prompt.error !== undefined) {
    problems.push(`Instructions not applied — ${prompt.error}`);
  } else if (prompt.prompt !== undefined) {
    patch.systemPrompt = prompt.prompt;
  }

  const proposedTools = params['tools'];
  if (Array.isArray(proposedTools)) {
    const names = proposedTools.filter((entry): entry is string => typeof entry === 'string');
    const resolved = resolveProposedTools(names, catalog, draft.tools);

    if (resolved.status === 'catalog-unavailable') {
      problems.push('Tools not applied — the tool catalogue is still loading. Try again.');
    } else if (resolved.status === 'resolved') {
      patch.tools = resolved.tools;
      if (resolved.unknown.length > 0) {
        problems.push(`Skipped unrecognised tool(s): ${resolved.unknown.join(', ')}`);
      }
      if (resolved.removed.length > 0) {
        problems.push(`Removed tool(s) you had selected: ${resolved.removed.join(', ')}`);
      }
    }
  }

  const unsettable = FIELDS_THIS_DRAFT_CANNOT_SET.filter(field => params[field] !== undefined);
  if (unsettable.length > 0) {
    problems.push(`Not applied — this draft cannot set: ${unsettable.join(', ')}.`);
  }

  return { patch, problems };
}
