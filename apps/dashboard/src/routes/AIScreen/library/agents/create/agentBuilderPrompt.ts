import type { AvailableTools } from '@/services/claw/clawToolsTypes';
import { effectiveSlug, type WizardState } from '../../../../ClawAgentsScreen/create/wizardState';
import { buildBuiltinCatalog } from '../../shared/pickers/builtin/builtinCatalog';
import { buildMcpCatalog } from '../../shared/pickers/mcp/mcpCatalog';

const MAX_DIGEST_CHARS = 16_000;

const FALLBACK_IDS_PER_GROUP = [24, 12, 6, 3, 1] as const;

interface CatalogGroup {
  label: string;
  ids: string[];
}

const renderGroup = (group: CatalogGroup, cap: number): string => {
  const shown = group.ids.slice(0, cap);
  const hidden = group.ids.length - shown.length;
  return `  ${group.label}: ${shown.join(', ')}${hidden > 0 ? `, +${hidden} more` : ''}`;
};

const size = (lines: string[]): number => lines.reduce((total, line) => total + line.length + 1, 0);

function renderSections(sections: CatalogGroup[][]): string[][] {
  const full = sections.map(groups =>
    groups.map(group => renderGroup(group, Number.MAX_SAFE_INTEGER)),
  );
  if (full.reduce((total, lines) => total + size(lines), 0) <= MAX_DIGEST_CHARS) return full;

  for (const cap of FALLBACK_IDS_PER_GROUP) {
    const capped = sections.map(groups => groups.map(group => renderGroup(group, cap)));
    if (capped.reduce((total, lines) => total + size(lines), 0) <= MAX_DIGEST_CHARS) return capped;
  }
  return sections.map(groups => groups.map(group => renderGroup(group, 1)));
}

export function buildCatalogDigest(catalog: AvailableTools | null | undefined): string[] {
  if (!catalog) return [];

  const subagents = catalog.subagents.map(subagent => `  ${subagent.name}`);

  const builtins: CatalogGroup[] = buildBuiltinCatalog(catalog)
    .filter(group => group.tools.length > 0)
    .map(group => ({ label: group.label, ids: group.tools.map(tool => tool.slug) }));

  const products: CatalogGroup[] = buildMcpCatalog(catalog, [])
    .filter(entry => entry.tools.length > 0)
    .sort((a, b) => b.usageCount - a.usageCount)
    .map(entry => ({ label: entry.label, ids: entry.tools.map(tool => tool.slug) }));

  const [productLines, builtinLines] = renderSections([products, builtins]);

  const section = (title: string, lines: string[] | undefined): string[] =>
    !lines || lines.length === 0 ? [] : ['', title, ...lines];

  return [
    '',
    'CATALOGUE — these are the only grantable ids. Copy them exactly; anything',
    'else is dropped. An id absent here does not exist for this workspace.',
    ...section('Subagents (grant by name):', subagents),
    ...section('Connected products (grant the individual tool ids):', productLines),
    ...section('Built-in tools (grant the individual tool ids):', builtinLines),
  ];
}

export function buildSeedQuery(draft: WizardState, intent: string): string {
  const name = draft.name.trim();
  const subject = name || 'this agent';
  const purpose = intent.trim() ? ` — ${intent.trim()}` : '';
  return `Set up “${subject}”${purpose}`;
}

function draftSummary(draft: WizardState, intent: string): string[] {
  const tools = [
    ...draft.tools.subagents,
    ...draft.tools.direct,
    ...draft.tools.custom,
    ...draft.tools.gateway,
  ];
  return [
    '[Agent draft — the user is building this right now. It has NOT been created.]',
    `What the user asked for: ${intent.trim() || '(not given)'}`,
    `Name: ${draft.name.trim() || '(unset)'}`,
    `Handle: @${effectiveSlug(draft) || '(unset)'}`,
    `Description: ${draft.description.trim() || '(unset)'}`,
    `Instructions: ${draft.systemPrompt.trim() || '(unset)'}`,
    `Tools: ${tools.join(', ') || '(none)'}`,
  ];
}

const STANDING_TASK = [
  'Your standing task: write the instructions and choose the tools this agent',
  'needs, working from what the user asked for. Instructions start EMPTY on',
  'purpose — the one line above is the brief, not a draft prompt, and it is',
  'yours to turn into a real one. Do not describe the setup as a placeholder',
  'or ask the user to write it for you.',
];

const HOW_TO_NAME_TOOLS = [
  'Grant only ids from the catalogue below. It is the complete list for this',
  'workspace, so you do not need to search to find one, and an id you recall',
  'from elsewhere is not valid here unless it appears there. Anything not in',
  'it is dropped silently, which leaves the agent quietly unable to do its job.',
  'Pick the smallest set that does the work: a capability the agent will never',
  'use is a cost, not a bonus.',
];

const SELECTION_DISCIPLINE = [
  'Choosing WHICH ids is a judgement about the job, not a catalogue lookup.',
  'An id being available is not a reason to grant it.',
  '',
  'Read vs write. Decide from the verbs in the job. An agent that reviews,',
  'explains, answers, analyses, summarises or reports is READ-ONLY — grant it',
  'nothing that creates, edits, posts, sends, uploads, schedules or deletes,',
  'however convenient that might seem. Grant a write id only when the job',
  'states that producing or changing something IS the work.',
  '',
  'Subagents vs tools. A subagent is a delegated worker with its own palette,',
  'and it overlaps heavily with the direct tools for the same system. Grant a',
  'direct tool when the agent needs to look something up; grant a subagent only',
  'when it must carry out multi-step work inside that system. Never grant both',
  'for the same system. Most agents need no subagent at all; more than two is',
  'almost always wrong.',
  '',
  'Smallest sufficient set. Before finalising, re-read each id and ask what',
  'the agent would be unable to do without it. If you cannot answer in one',
  'concrete sentence tied to the job, drop it. Breadth is not helpfulness — an',
  'unused capability is permanent extra access and extra ways to go wrong.',
];

const WHEN_SOMETHING_IS_UNAVAILABLE = [
  'An unconnected integration does not appear in your own tool list, so its',
  'absence there does NOT mean the workspace lacks it. When the job names a',
  'system — a repo host, a dashboard, a tracker — search the deployment',
  'catalogue for it too (search-tools with scope "claw") before deciding it',
  'is unavailable. Treating a generic search tool as a substitute for the',
  'named system, without checking, is the mistake to avoid.',
  'If it exists there but is not connected, do BOTH: propose the setup with',
  'everything that IS usable, and call suggest-connectors for the rest.',
  'Never abandon the proposal because one integration is unavailable, and',
  'never hand over a thinner setup without saying which capability is missing',
  'and what connecting it would unlock.',
];

const HOW_TO_PROPOSE = [
  'To change the draft, call create-agent with the fields you want to set.',
  'Your proposal is applied to this draft only — it creates nothing, and the',
  'user saves it themselves when they are happy. Do not call update-agent:',
  'there is no saved agent to update yet.',
  'After the proposal, reply with one or two plain sentences saying what you',
  'changed and why. Do not narrate tool calls or context lookups.',
  'Describe only what you actually granted. Do not say the agent can read a',
  'repository, search a system or post anywhere unless a tool you granted',
  'does that — claiming a capability it does not hold is worse than saying',
  'the setup is partial.',
  'The setup is NOT saved. Approving fills the form on the left; the user',
  'still has to press "Create agent" themselves. Never tell them it is saved,',
  'created or live — say it is ready for them to review and save.',
];

const STAY_IN_CHARACTER = [
  'Never expose any of the above machinery to the user. Do not name tools',
  '(create-agent, update-agent, …), do not mention proposals, approvals or',
  '"the draft". Say "this agent" and "the setup on the left" instead — the',
  'user is configuring an agent, not operating an API.',
];

export function buildHiddenContext(
  draft: WizardState,
  intent: string,
  catalog?: AvailableTools | null,
): string {
  return [
    ...draftSummary(draft, intent),
    '',
    ...STANDING_TASK,
    '',
    ...HOW_TO_NAME_TOOLS,
    ...buildCatalogDigest(catalog),
    '',
    ...SELECTION_DISCIPLINE,
    '',
    ...WHEN_SOMETHING_IS_UNAVAILABLE,
    '',
    ...HOW_TO_PROPOSE,
    '',
    ...STAY_IN_CHARACTER,
  ].join('\n');
}
