/**
 * Hub plan for agent create: ONE fast suggest-tools call (XOR-backed, ~1s) that
 * decides MCP, built-in tools, subagents, skills and knowledge together. The
 * caller starts it at the top of the turn so it hides behind the identity
 * animation, then `hubPatchFromPlan` turns the response into a canvas patch
 * (auto-bound picks) plus dashed one-click chips (mid-confidence picks).
 *
 * Pure apart from `requestHubPlan` / `loadHubPlanContext`, which reach the
 * network through dynamic imports so node tests can load this module.
 */

import type { KbCollectionNode, KbSelection } from '@/services/claw/clawKnowledgeBaseTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import type {
  AgentToolboxSelection,
  AvailableTools,
  SuggestedIntegration,
  SuggestHub,
  ToolSuggestion,
} from '@/services/claw/clawToolsTypes';
import {
  buildBuiltinCatalog,
  isEntryEnabled as isBuiltinEntryEnabled,
} from '@/routes/AIScreen/library/shared/pickers/builtin/builtinCatalog';
import { buildKbIndex } from '@/routes/AIScreen/library/shared/pickers/knowledge/knowledgeCatalog';
import {
  buildMcpCatalog,
  enableEntry,
  isEntryEnabled as isMcpEntryEnabled,
} from '@/routes/AIScreen/library/shared/pickers/mcp/mcpCatalog';
import {
  describeSelectedTools,
  filterIrrelevantChatMcps,
  matchNamedMcpEntries,
  selectionFromCatalogSuggestion,
} from './hubCatalogSelect.ts';
import { toolboxFromSuggestion } from './toolboxFromSuggestion.ts';
import type {
  AgentCreateChatPatch,
  AgentCreateFormState,
  AgentCreateHubRow,
  CreateHubSuggestions,
  HubPickKind,
} from './types.ts';

/** The suggest-tools response, used as the plan. */
export type HubPlanResult = ToolSuggestion;

/** Hub draft fields a plan can fill (mirrors `inferredCapabilityFields`). */
export type HubPlanField = 'tools' | 'skills' | 'knowledge';

/** Hard client-side ceiling; late responses are ignored. */
export const HUB_PLAN_TIMEOUT_MS = 4_000;

const ALL_HUBS: readonly SuggestHub[] = ['mcp', 'builtin', 'subagent', 'skill', 'knowledge'];

export const EMPTY_HUB_SUGGESTIONS: CreateHubSuggestions = {
  mcp: [],
  builtin: [],
  subagents: [],
  skills: [],
  knowledge: [],
};

/** True when the selector scored every hub, so canvas heal / Create block can be skipped. */
export function isAuthoritativePlan(plan: HubPlanResult | null | undefined): boolean {
  return plan?.source === 'xor' && plan.needs !== undefined;
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

/**
 * One suggest-tools call for all five hubs. `intent` is the user's latest text
 * (the route prefers it over the system prompt). Resolves `null` on timeout or
 * error — the fetch cannot be aborted, so a late response is simply dropped.
 */
export async function requestHubPlan(args: {
  intent: string;
  systemPrompt?: string | undefined;
  timeoutMs?: number | undefined;
}): Promise<HubPlanResult | null> {
  const intent = args.intent.trim();
  if (!intent) return null;
  const systemPrompt = args.systemPrompt?.trim();
  const timeoutMs = args.timeoutMs ?? HUB_PLAN_TIMEOUT_MS;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<null>(resolve => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  const call = (async (): Promise<HubPlanResult | null> => {
    try {
      const { suggestTools } = await import('@/services/claw/clawToolsService');
      return await suggestTools({
        description: intent.slice(0, 2_000),
        ...(systemPrompt ? { systemPrompt: systemPrompt.slice(0, 4_000) } : {}),
        emptyHubs: [...ALL_HUBS],
      });
    } catch {
      return null;
    }
  })();
  try {
    return await Promise.race([call, deadline]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export interface HubPlanContext {
  catalog: AvailableTools | null;
  skills: Skill[];
  collections: KbCollectionNode[];
}

/** Catalog + skills + KB tree the plan resolves against, fetched in parallel. */
export async function loadHubPlanContext(
  userId: string | undefined,
  timeoutMs: number = HUB_PLAN_TIMEOUT_MS,
): Promise<HubPlanContext> {
  const guarded = <T>(work: () => Promise<T>, fallback: T): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<T>(resolve => {
      timer = setTimeout(() => resolve(fallback), timeoutMs);
    });
    return Promise.race([work().catch(() => fallback), timeout]).finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    });
  };
  const [catalog, skills, collections] = await Promise.all([
    guarded(
      async () => (await import('@/services/claw/clawToolsService')).getAvailableTools(),
      null as AvailableTools | null,
    ),
    guarded(async (): Promise<Skill[]> => {
      if (!userId) return [];
      return (await import('@/services/claw/clawSkillsService')).listSkills(userId);
    }, []),
    guarded(
      async () =>
        (await import('@/services/claw/clawKnowledgeBaseService')).listAccessibleKnowledgeBase(),
      { collections: [] as KbCollectionNode[], noSpacesSession: false },
    ).then(result => result.collections),
  ]);
  return { catalog, skills, collections };
}

// ---------------------------------------------------------------------------
// Dismissed picks + suggestion state helpers
// ---------------------------------------------------------------------------

/** Ids the user removed this session, per hub — a re-run never re-adds them. */
export type DismissedHubIds = Record<HubPickKind, Set<string>>;

export function createDismissedHubIds(): DismissedHubIds {
  return {
    mcp: new Set(),
    builtin: new Set(),
    subagent: new Set(),
    skill: new Set(),
    knowledge: new Set(),
  };
}

export function dismissHubPick(dismissed: DismissedHubIds, kind: HubPickKind, id: string): void {
  dismissed[kind].add(id);
}

/** Drop one id from the suggested chips (accepted or dismissed). */
export function removeHubSuggestion(
  suggestions: CreateHubSuggestions,
  kind: HubPickKind,
  id: string,
): CreateHubSuggestions {
  switch (kind) {
    case 'mcp':
      return { ...suggestions, mcp: suggestions.mcp.filter(pick => pick.slug !== id) };
    case 'builtin':
      return { ...suggestions, builtin: suggestions.builtin.filter(pick => pick.slug !== id) };
    case 'subagent':
      return { ...suggestions, subagents: suggestions.subagents.filter(pick => pick.name !== id) };
    case 'skill':
      return { ...suggestions, skills: suggestions.skills.filter(pick => pick.id !== id) };
    case 'knowledge':
      return { ...suggestions, knowledge: suggestions.knowledge.filter(pick => pick.id !== id) };
    default:
      return suggestions;
  }
}

/** Take the slices for `hubs` from `next`; keep the rest of `prev`. */
export function replaceHubSuggestions(
  prev: CreateHubSuggestions,
  next: CreateHubSuggestions,
  hubs: readonly HubPlanField[],
): CreateHubSuggestions {
  const tools = hubs.includes('tools');
  return {
    mcp: tools ? next.mcp : prev.mcp,
    builtin: tools ? next.builtin : prev.builtin,
    subagents: tools ? next.subagents : prev.subagents,
    skills: hubs.includes('skills') ? next.skills : prev.skills,
    knowledge: hubs.includes('knowledge') ? next.knowledge : prev.knowledge,
  };
}

export function hubSuggestionCount(suggestions: CreateHubSuggestions): number {
  return (
    suggestions.mcp.length +
    suggestions.builtin.length +
    suggestions.subagents.length +
    suggestions.skills.length +
    suggestions.knowledge.length
  );
}

// ---------------------------------------------------------------------------
// Plan -> canvas patch
// ---------------------------------------------------------------------------

export interface HubPatchFromPlanArgs {
  plan: HubPlanResult;
  /** User text + draft intent: hard-named products in it still bind. */
  intent: string;
  catalog: AvailableTools | null;
  current: Pick<
    AgentCreateFormState,
    'tools' | 'selectedSkillIds' | 'selectedKbScope' | 'selectedKbResources'
  >;
  skills: readonly Skill[];
  kbCollections: readonly KbCollectionNode[];
  /** Ids the user removed this session. */
  dismissed: DismissedHubIds;
}

export interface HubPlanPatch {
  /** Auto-bound picks as a canvas patch (tools / skills / knowledge slices). */
  patch: AgentCreateChatPatch;
  /** Labels of newly bound tools (`subagent:` / `builtin:` prefixes, like describeSelectedTools). */
  labels: string[];
  skillLabels: string[];
  knowledgeLabels: string[];
  /** Mid-confidence picks as dashed chips (bound picks excluded). */
  suggestions: CreateHubSuggestions;
  /** Every pick, bound included, as chips — for a plan that lands too late to apply. */
  allSuggestions: CreateHubSuggestions;
  suggestedLabels: string[];
  suggestedSkillLabels: string[];
  suggestedKnowledgeLabels: string[];
  /** Hubs the plan has content for (bound or suggested). */
  fields: HubPlanField[];
  /** Tools row the write pointer should rest on. */
  preferredHubRow: AgentCreateHubRow;
  /** Capability summary for the instructions prompt. */
  summary: string;
}

interface PlanPicks {
  integrations: SuggestedIntegration[];
  subagents: Array<{ name: string; confidence: number }>;
  skills: Array<{ slug: string; confidence: number }>;
  knowledge: Array<{ id: string; name: string; confidence: number }>;
}

function pickConfidence(plan: HubPlanResult, hubs: readonly SuggestHub[], id: string): number {
  for (const hub of hubs) {
    const hit = (plan.hubs?.[hub]?.picks ?? []).find(pick => pick.id === id);
    if (typeof hit?.confidence === 'number') return hit.confidence;
  }
  return 1;
}

function isMcpLane(kind: string): boolean {
  return kind === 'mcp' || kind === 'gateway';
}

function integrationDismissed(dismissed: DismissedHubIds, slug: string): boolean {
  return dismissed.mcp.has(slug) || dismissed.builtin.has(slug);
}

function sameToolIds(a: AgentToolboxSelection, b: AgentToolboxSelection): boolean {
  const same = (x: readonly string[], y: readonly string[]): boolean =>
    x.length === y.length && x.every(item => y.includes(item));
  return (
    same(a.subagents, b.subagents) &&
    same(a.direct, b.direct) &&
    same(a.custom, b.custom) &&
    same(a.gateway ?? [], b.gateway ?? [])
  );
}

function boundPicks(
  plan: HubPlanResult,
  catalog: AvailableTools | null,
  kbNames: ReadonlyMap<string, string>,
): PlanPicks {
  return {
    integrations: (plan.integrations ?? []).map(item => ({
      slug: item.slug,
      label: catalog?.integrations.find(entry => entry.slug === item.slug)?.label ?? item.slug,
      confidence: pickConfidence(plan, ['mcp', 'builtin'], item.slug),
      readTools: item.readTools ?? [],
      writeTools: item.writeTools ?? [],
    })),
    subagents: (plan.subagents ?? []).map(name => ({
      name,
      confidence: pickConfidence(plan, ['subagent'], name),
    })),
    skills: (plan.skillSlugs ?? []).map(slug => ({
      slug,
      confidence: pickConfidence(plan, ['skill'], slug),
    })),
    knowledge: (plan.knowledgeIds ?? []).map(id => ({
      id,
      name: kbNames.get(id) ?? id,
      confidence: pickConfidence(plan, ['knowledge'], id),
    })),
  };
}

function suggestedPicks(plan: HubPlanResult): PlanPicks {
  return {
    integrations: plan.suggested?.integrations ?? [],
    subagents: plan.suggested?.subagents ?? [],
    skills: plan.suggested?.skills ?? [],
    knowledge: plan.suggested?.knowledge ?? [],
  };
}

/** Resolve raw picks against the catalog / skills / KB, dropping selected and dismissed ones. */
function resolveSuggestions(args: {
  picks: readonly PlanPicks[];
  catalog: AvailableTools | null;
  selection: AgentToolboxSelection;
  selectedSkillIds: readonly string[];
  selectedKb: readonly KbSelection[];
  skillBySlug: ReadonlyMap<string, Skill>;
  kbNames: ReadonlyMap<string, string>;
  dismissed: DismissedHubIds;
}): CreateHubSuggestions {
  const { catalog, selection, dismissed } = args;
  const out: CreateHubSuggestions = {
    mcp: [],
    builtin: [],
    subagents: [],
    skills: [],
    knowledge: [],
  };
  const mcpEntries = catalog ? buildMcpCatalog(catalog, []) : [];
  const builtinEntries = catalog ? buildBuiltinCatalog(catalog) : [];
  const seen = new Set<string>();
  const selectedKbIds = new Set(args.selectedKb.map(grant => grant.collectionId));

  for (const set of args.picks) {
    for (const pick of set.integrations) {
      if (!catalog || seen.has(`i:${pick.slug}`) || integrationDismissed(dismissed, pick.slug)) {
        continue;
      }
      const integration = catalog.integrations.find(entry => entry.slug === pick.slug);
      if (!integration) continue;
      if (isMcpLane(integration.kind)) {
        const entry = mcpEntries.find(row => row.slug === pick.slug);
        if (!entry || !entry.selectable || isMcpEntryEnabled(selection, entry)) continue;
        const named = pick.readTools.length + pick.writeTools.length > 0;
        seen.add(`i:${pick.slug}`);
        out.mcp.push({
          ...pick,
          label: entry.label || pick.label,
          // Nothing named: offer the read tools only, never the whole write surface.
          readTools: named
            ? pick.readTools
            : entry.tools.filter(tool => tool.riskLevel === 'read').map(tool => tool.name),
        });
      } else {
        const entry = builtinEntries.find(row => row.source === pick.slug);
        if (!entry || isBuiltinEntryEnabled(selection, entry)) continue;
        const named = pick.readTools.length + pick.writeTools.length > 0;
        seen.add(`i:${pick.slug}`);
        out.builtin.push({
          ...pick,
          label: entry.label || pick.label,
          readTools: named ? pick.readTools : entry.tools.map(tool => tool.name),
        });
      }
    }
    for (const pick of set.subagents) {
      if (seen.has(`s:${pick.name}`) || dismissed.subagent.has(pick.name)) continue;
      if (selection.subagents.includes(pick.name)) continue;
      if (catalog && !catalog.subagents.some(entry => entry.name === pick.name)) continue;
      seen.add(`s:${pick.name}`);
      out.subagents.push(pick);
    }
    for (const pick of set.skills) {
      const skill = args.skillBySlug.get(pick.slug);
      if (!skill || seen.has(`k:${skill.id}`) || dismissed.skill.has(skill.id)) continue;
      if (args.selectedSkillIds.includes(skill.id)) continue;
      seen.add(`k:${skill.id}`);
      out.skills.push({
        id: skill.id,
        label: skill.label || skill.name || skill.slug,
        confidence: pick.confidence,
      });
    }
    for (const pick of set.knowledge) {
      if (!args.kbNames.has(pick.id) || seen.has(`b:${pick.id}`)) continue;
      if (dismissed.knowledge.has(pick.id) || selectedKbIds.has(pick.id)) continue;
      seen.add(`b:${pick.id}`);
      out.knowledge.push({
        id: pick.id,
        name: args.kbNames.get(pick.id) ?? pick.name,
        confidence: pick.confidence,
      });
    }
  }
  return out;
}

function toolLabelsForSuggestions(suggestions: CreateHubSuggestions): string[] {
  return [
    ...suggestions.mcp.map(pick => pick.label),
    ...suggestions.builtin.map(pick => `builtin:${pick.label}`),
    ...suggestions.subagents.map(pick => `subagent:${pick.name}`),
  ];
}

/**
 * Turn a plan into a canvas patch plus suggested chips.
 *
 * XOR plans are authoritative: `filterSuggestionToRelevant` and the "only
 * regex-empty hubs" gating are skipped, and only hard-named products (never
 * soft job cues) are unioned in. Judge / shortlist plans keep the legacy
 * `selectionFromCatalogSuggestion` grounding.
 */
export function hubPatchFromPlan(args: HubPatchFromPlanArgs): HubPlanPatch {
  const { plan, intent, catalog, current, dismissed } = args;
  const xor = plan.source === 'xor';
  const skillBySlug = new Map(args.skills.map(skill => [skill.slug, skill]));
  const kbNames = new Map<string, string>(
    [...buildKbIndex(args.kbCollections)].map(([id, entry]): [string, string] => [id, entry.name]),
  );

  // --- Tools: MCP, built-in, subagents -------------------------------------
  const currentTools: AgentToolboxSelection = {
    ...current.tools,
    callableAgents: current.tools.callableAgents ?? [],
  };
  let selection = currentTools;
  if (catalog) {
    const boundSuggestion: ToolSuggestion = {
      subagents: (plan.subagents ?? []).filter(
        name =>
          !dismissed.subagent.has(name) && catalog.subagents.some(entry => entry.name === name),
      ),
      integrations: (plan.integrations ?? []).filter(
        item => !integrationDismissed(dismissed, item.slug),
      ),
      reasoning: plan.reasoning ?? {},
    };
    if (xor) {
      selection = toolboxFromSuggestion(currentTools, boundSuggestion, catalog);
      // A product the user named stays bound even when the plan missed it.
      const mcpCatalog = buildMcpCatalog(catalog, []);
      for (const entry of matchNamedMcpEntries(intent, catalog, { hardOnly: true })) {
        selection = {
          ...enableEntry(mcpCatalog, selection, entry),
          callableAgents: selection.callableAgents ?? [],
        };
      }
      selection = filterIrrelevantChatMcps(selection, intent, catalog);
    } else {
      selection = selectionFromCatalogSuggestion({
        current: currentTools,
        suggestion: boundSuggestion,
        catalog,
        intent,
      });
    }
  }
  const toolsChanged = !sameToolIds(selection, currentTools);
  const labelsBefore = new Set(describeSelectedTools(currentTools, catalog));
  const selectedLabels = describeSelectedTools(selection, catalog);
  const labels = selectedLabels.filter(label => !labelsBefore.has(label));

  // --- Skills ---------------------------------------------------------------
  const boundSkills = (plan.skillSlugs ?? []).flatMap(slug => {
    const skill = skillBySlug.get(slug);
    return skill && !dismissed.skill.has(skill.id) ? [skill] : [];
  });
  const selectedSkillIds = [
    ...new Set([...current.selectedSkillIds, ...boundSkills.map(s => s.id)]),
  ];
  const newSkills = boundSkills.filter(skill => !current.selectedSkillIds.includes(skill.id));
  const skillLabels = newSkills.map(skill => skill.label || skill.name || skill.slug);

  // --- Knowledge ------------------------------------------------------------
  const grantedIds = new Set(current.selectedKbResources.map(grant => grant.collectionId));
  const newGrants: KbSelection[] = [
    ...new Set(
      (plan.knowledgeIds ?? []).filter(
        id => kbNames.has(id) && !dismissed.knowledge.has(id) && !grantedIds.has(id),
      ),
    ),
  ].map(id => ({ collectionId: id, fileId: null }));
  const knowledgeLabels = newGrants.map(grant => kbNames.get(grant.collectionId) ?? 'Collection');

  const patch: AgentCreateChatPatch = {};
  if (toolsChanged) patch.tools = selection;
  if (newSkills.length > 0) patch.selectedSkillIds = selectedSkillIds;
  if (newGrants.length > 0) {
    patch.selectedKbScope = 'COLLECTIONS';
    patch.selectedKbResources = [...current.selectedKbResources, ...newGrants];
  }

  // --- Suggested chips ------------------------------------------------------
  const common = {
    catalog,
    selectedSkillIds,
    skillBySlug,
    kbNames,
    dismissed,
  };
  const bound = boundPicks(plan, catalog, kbNames);
  const suggestions = resolveSuggestions({
    ...common,
    picks: [suggestedPicks(plan)],
    selection,
    selectedKb: patch.selectedKbResources ?? current.selectedKbResources,
  });
  const allSuggestions = resolveSuggestions({
    ...common,
    picks: [bound, suggestedPicks(plan)],
    selection: currentTools,
    selectedSkillIds: current.selectedSkillIds,
    selectedKb: current.selectedKbResources,
  });

  const fields: HubPlanField[] = [];
  if (
    toolsChanged ||
    suggestions.mcp.length + suggestions.builtin.length + suggestions.subagents.length > 0
  ) {
    fields.push('tools');
  }
  if (newSkills.length > 0 || suggestions.skills.length > 0) fields.push('skills');
  if (newGrants.length > 0 || suggestions.knowledge.length > 0) fields.push('knowledge');

  const preferredHubRow = ((): AgentCreateHubRow => {
    if (labels.some(label => !label.startsWith('subagent:') && !label.startsWith('builtin:'))) {
      return 'mcp';
    }
    if (labels.some(label => label.startsWith('builtin:'))) return 'builtin';
    if (labels.some(label => label.startsWith('subagent:'))) return 'subagent';
    if (suggestions.mcp.length > 0) return 'mcp';
    if (suggestions.builtin.length > 0) return 'builtin';
    if (suggestions.subagents.length > 0) return 'subagent';
    return 'mcp';
  })();

  return {
    patch,
    labels,
    skillLabels,
    knowledgeLabels,
    suggestions,
    allSuggestions,
    suggestedLabels: toolLabelsForSuggestions(suggestions),
    suggestedSkillLabels: suggestions.skills.map(pick => pick.label),
    suggestedKnowledgeLabels: suggestions.knowledge.map(pick => pick.name),
    fields,
    preferredHubRow,
    summary: describePlanCapabilities({
      plan,
      selectedLabels,
      catalog,
      skillLabels: args.skills
        .filter(skill => selectedSkillIds.includes(skill.id))
        .map(skill => skill.label || skill.name || skill.slug),
      knowledgeNames: [
        ...new Set([...grantedIds, ...newGrants.map(grant => grant.collectionId)]),
      ].map(id => kbNames.get(id) ?? id),
      suggestions,
    }),
  };
}

/**
 * Richer capability line for the instructions prompt than a bare tool list:
 * read vs write per integration, plus the picks the user may still add.
 */
function describePlanCapabilities(args: {
  plan: HubPlanResult;
  selectedLabels: readonly string[];
  catalog: AvailableTools | null;
  skillLabels: readonly string[];
  knowledgeNames: readonly string[];
  suggestions: CreateHubSuggestions;
}): string {
  const modeByLabel = new Map<string, string>();
  for (const item of args.plan.integrations ?? []) {
    const label = args.catalog?.integrations.find(entry => entry.slug === item.slug)?.label;
    if (!label) continue;
    modeByLabel.set(label, (item.writeTools ?? []).length > 0 ? 'read and write' : 'read-only');
  }
  const parts: string[] = [];
  for (const label of args.selectedLabels) {
    if (label.startsWith('subagent:')) parts.push(`subagent ${label.slice('subagent:'.length)}`);
    else if (label.startsWith('builtin:')) parts.push(`built-in ${label.slice('builtin:'.length)}`);
    else {
      const mode = modeByLabel.get(label);
      parts.push(mode ? `${label} (${mode})` : label);
    }
  }
  for (const label of args.skillLabels) parts.push(`skill ${label}`);
  for (const name of args.knowledgeNames) parts.push(`knowledge ${name}`);
  const lines: string[] = [];
  if (parts.length > 0) lines.push(parts.join('; '));
  const optional = [
    ...toolLabelsForSuggestions(args.suggestions).map(label =>
      label.replace(/^subagent:/, 'subagent ').replace(/^builtin:/, 'built-in '),
    ),
    ...args.suggestions.skills.map(pick => `skill ${pick.label}`),
    ...args.suggestions.knowledge.map(pick => `knowledge ${pick.name}`),
  ];
  if (optional.length > 0) {
    lines.push(`Also relevant but not attached (the user may add them): ${optional.join('; ')}`);
  }
  if ((args.plan.writes ?? 0) > 0) {
    lines.push('The job includes write actions: have the agent state what it will change first.');
  }
  return lines.join('\n');
}
