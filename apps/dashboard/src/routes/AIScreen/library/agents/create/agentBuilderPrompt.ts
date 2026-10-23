import type { KbCollectionNode } from '@/services/claw/clawKnowledgeBaseTypes';
import type { Skill } from '@/services/claw/clawSkillsTypes';
import type { AvailableTools } from '@/services/claw/clawToolsTypes';
import { effectiveSlug, type WizardState } from '../../../../ClawAgentsScreen/create/wizardState';
import { buildBuiltinCatalog } from '../../shared/pickers/builtin/builtinCatalog';
import { buildMcpCatalog, isEntryEnabled } from '../../shared/pickers/mcp/mcpCatalog';

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

export function buildCatalogDigest(
  catalog: AvailableTools | null | undefined,
  skills?: readonly Skill[] | null,
  collections?: readonly KbCollectionNode[] | null,
): string[] {
  if (!catalog) return [];

  const subagents = catalog.subagents.map(subagent => `  ${subagent.name}`);
  const skillNames = (skills ?? []).map(skill => `  ${skill.name}`);
  const collectionNames = (collections ?? []).map(node => `  ${node.name}`);

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
    ...section(
      'Integrations — the NAME before each colon is what `mcps` accepts (copy it exactly); the ids after it are individual tools for `tools`:',
      productLines,
    ),
    ...section('Built-in tools (grant the individual tool ids):', builtinLines),
    ...section('Skills — attach by name via `skills`:', skillNames),
    ...section(
      'Knowledge collections — attach by name via `knowledge.collections`:',
      collectionNames,
    ),
  ];
}

function attachedMcps(state: WizardState, catalog: AvailableTools | null | undefined): string[] {
  if (!catalog) return [];
  return buildMcpCatalog(catalog, [])
    .filter(entry => isEntryEnabled(state.tools, entry))
    .map(entry => entry.label);
}

function draftSummary(draft: WizardState, mcps: string[]): string[] {
  const tools = [
    ...draft.tools.subagents,
    ...draft.tools.direct,
    ...draft.tools.custom,
    ...draft.tools.gateway,
  ];
  return [
    '[Agent draft — the user is building this right now. It has NOT been created.]',
    `Name: ${draft.name.trim() || '(unset)'}`,
    `Handle: @${effectiveSlug(draft) || '(unset)'}`,
    `Description: ${draft.description.trim() || '(unset)'}`,
    `Instructions: ${draft.systemPrompt.trim() || '(unset)'}`,
    `Subagents: ${draft.tools.subagents.join(', ') || '(none)'}`,
    `MCPs attached: ${mcps.join(', ') || '(none)'}`,
    `Tools: ${tools.join(', ') || '(none)'}`,
    '',
    'Those lines are the CURRENT state — read them before you answer. Do not',
    'claim an MCP, subagent or tool is attached unless it is listed above, and',
    'do not assume something you added earlier survived: the user removes things',
    'by hand too.',
  ];
}

function toolNames(state: WizardState): string[] {
  return [
    ...state.tools.subagents,
    ...state.tools.direct,
    ...state.tools.custom,
    ...state.tools.gateway,
  ];
}

function unsavedFields(saved: WizardState, draft: WizardState): string[] {
  const changed: string[] = [];
  if (saved.name.trim() !== draft.name.trim()) changed.push('name');
  if (effectiveSlug(saved) !== effectiveSlug(draft)) changed.push('handle');
  if (saved.description.trim() !== draft.description.trim()) changed.push('description');
  if (saved.systemPrompt.trim() !== draft.systemPrompt.trim()) changed.push('instructions');
  if (toolNames(saved).join() !== toolNames(draft).join()) changed.push('tools');
  return changed;
}

function savedSummary(saved: WizardState, draft: WizardState, mcps: string[]): string[] {
  const unsaved = unsavedFields(saved, draft);
  return [
    '[Agent saved — this is what is stored right now.]',
    `Name: ${saved.name.trim() || '(unset)'}`,
    `Handle: @${effectiveSlug(saved) || '(unset)'}`,
    `Description: ${saved.description.trim() || '(unset)'}`,
    `Subagents: ${saved.tools.subagents.join(', ') || '(none)'}`,
    `MCPs attached: ${mcps.join(', ') || '(none)'}`,
    `Tools: ${toolNames(saved).join(', ') || '(none)'}`,
    '',
    'Those lines are the CURRENT state — read them before you answer. Do not',
    'claim an MCP, subagent or tool is attached unless it is listed above, and',
    'do not assume something you added earlier survived: the user removes things',
    'by hand too.',
    '',
    'Saved instructions — anchor promptEdits against THIS text, character for',
    'character. It is what the server will search; the form may differ.',
    saved.systemPrompt.trim() || '(unset)',
    '',
    unsaved.length > 0
      ? `The setup on the left has unsaved edits to: ${unsaved.join(', ')}. The user has not saved them, so they are NOT in the text above — do not anchor on them.`
      : 'The setup on the left matches what is saved.',
  ];
}

const STANDING_TASK = [
  'Your standing task: name this agent, write its instructions and choose the',
  'tools it needs. The setup starts EMPTY on purpose — the user tells you what',
  'they want in chat, and turning that into a real configuration is your job,',
  'not theirs. Do not describe the setup as a placeholder or ask the user to',
  'write it for you.',
  '',
  'The conversation opens with a bare request for help that names no job —',
  '"Help me set up an agent". That is a greeting, not a brief. Answer it with',
  'one short, friendly question asking what the agent should do, and propose',
  'NOTHING until they tell you. Do not invent a generic assistant, do not list',
  'what you could build, and do not call a tool on that turn.',
  '',
  'Once they describe the job, act on it. Ask again only when you could not',
  'pick tools without the answer — a thin brief is still enough to propose a',
  'sensible starting point the user can correct.',
  '',
  'Name it the way a colleague would refer to it: short, concrete, title case',
  '("PR Reviewer", "Release Notes", "Support Triage"). Not "Agent for reviewing',
  'pull requests", and not a restatement of the request.',
];

const HOW_TO_NAME_TOOLS = [
  'Grant only ids from the catalogue below. It is the complete list for this',
  'workspace, so you do not need to search to find one, and an id you recall',
  'from elsewhere is not valid here unless it appears there. Anything not in',
  'it is dropped silently, which leaves the agent quietly unable to do its job.',
  'Pick the smallest set that does the work: a capability the agent will never',
  'use is a cost, not a bonus.',
  '',
  'An INTEGRATION the user names — "add the Slack MCP", "give it GitHub" —',
  'goes in `mcps`, NEVER in `tools`. Most integrations also ship a subagent',
  'under the SAME name, and a name in `tools` always resolves to the subagent,',
  'so putting it there hands the user a subagent instead of the MCP they asked',
  'for, with nothing to show it happened. Use `tools` for subagents, built-ins',
  'and individual tool slugs only.',
  '',
  'An integration listed under "MCPs attached" already brings its whole tool',
  'set. Keep its name in `mcps` and do NOT copy its individual tool ids into',
  '`tools` — that list is long, it adds nothing, and re-typing it is how ids',
  "get lost. Granting a subagent for a system never removes that system's MCP",
  'or tools; the two coexist.',
  '',
  '`skills` and `knowledge.collections` REPLACE their lists rather than adding',
  'to them, so always send the complete intended set — everything already',
  'attached, plus what you are adding, minus only what the user asked to drop.',
  'Send a partial list and the rest are removed without being mentioned.',
  '',
  'There is no cap on how many subagents, MCPs or tools this agent can hold.',
  'When the user asks for one, add it and leave everything else alone — never',
  'drop or swap an existing capability to "make room", and never tell them you',
  'had to trade one away.',
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
  'To change the draft, call propose-agent with the setup you want.',
  'Your proposal is applied to this draft only — it creates nothing, and the',
  'user saves it themselves when they are happy. Do not call create-agent or',
  'update-agent: there is no saved agent yet, and they would bypass the form.',
  'ALWAYS send `summary`. The call ENDS your turn — you do not get to reply',
  'afterwards, so `summary` is the only thing the user reads from you. Omit it',
  'and they get a blank stand-in that tells them nothing. One or two plain',
  'sentences on what you changed and why; no tool names, no narration.',
  '',
  '`summary` must describe the setup you are ACTUALLY sending in this call.',
  'Before you write it, re-read your own `tools` and `mcps` arrays and name',
  'only what is in them. A capability you decided against, or could not fit,',
  'is not in the setup no matter how reasonable it sounded — saying you added',
  'it is the worst outcome here, because the user believes it and finds out',
  'later. If the user asked for something by name and you are not granting it,',
  'say so plainly in `summary` and give the reason.',
  'The setup is NOT saved. Your proposal fills in the panel on the left, and',
  'the user creates it when they are happy with it. Never tell them it is',
  'saved, created or live — say it is ready for them to review and create.',
  '',
  'They can also just tell you to do it. When their latest message plainly',
  'approves the setup as it already stands — "create it", "yes, go ahead",',
  '"looks good, make it" — send `commit: true` with your proposal and the',
  'panel creates it for them.',
  '',
  'Approval is the ONLY thing that sets `commit`. A request to add, remove or',
  'change something is not approval, however enthusiastic — do that change and',
  'leave `commit` out. When you cannot tell which they meant, leave it out and',
  'ask: a draft they wanted committed costs one sentence, an agent created',
  'before they were ready is theirs to find and delete.',
  '',
  'Setting `commit` does NOT let you report the outcome. Your turn ends before',
  'the panel acts and you will not learn whether it worked, so say what you are',
  'creating, never that it is created. The panel tells them the result.',
];

function howToUpdate(slug: string): string[] {
  return [
    `The agent \`${slug}\` has been created and is saved. propose-agent is done —`,
    'calling it again only fails on the taken handle. To change anything now,',
    `call update-agent with slug "${slug}" and only the fields that change.`,
    '`tools` is the ONE exception: it REPLACES the whole list rather than adding',
    'to it, so sending only the new capability silently strips every other one',
    'the agent already has. When tools change, send the complete intended set —',
    'everything under "Tools:" above, plus what you are adding, minus anything',
    'the user asked to drop. That line is the current list; you do not need to',
    'look it up. Leave `tools` out entirely when you are not changing it.',
    'For promptEdits, anchor on the "Saved instructions" block above and nothing',
    'else — that is the text the server searches. Quote it exactly, including',
    'punctuation and line breaks. Anything listed as unsaved is not in it yet.',
    'The change lands on the setup on the left as an UNSAVED edit. The user',
    'presses "Save changes" there, or tells you to — when their latest message',
    'plainly approves saving what is already there ("save it", "yes, apply',
    'that"), send `commit: true` and the panel saves it for them.',
    '',
    'Approval is the ONLY thing that sets `commit`. A request to add, remove or',
    'change something is not approval — make the change and leave `commit` out.',
    'When you cannot tell, leave it out and ask.',
    '',
    'Setting `commit` does NOT let you report the outcome. Your turn ends before',
    'the panel acts, so say what you are saving, never that it is saved.',
    'After it, reply with one or two plain sentences saying what you changed and',
    'why. Do not narrate tool calls or context lookups.',
    'Describe only what you actually granted. Do not say the agent can read a',
    'repository, search a system or post anywhere unless a tool you granted',
    'does that — claiming a capability it does not hold is worse than saying',
    'the setup is partial.',
  ];
}

const STAY_IN_CHARACTER = [
  'Never expose any of the above machinery to the user. Do not name tools',
  '(create-agent, update-agent, …), do not mention proposals, approvals or',
  '"the draft". Say "this agent" and "the setup on the left" instead — the',
  'user is configuring an agent, not operating an API.',
];

export function buildHiddenContext(
  draft: WizardState,
  catalog?: AvailableTools | null,
  skills?: readonly Skill[] | null,
  collections?: readonly KbCollectionNode[] | null,
  createdSlug?: string | null,
  saved?: WizardState | null,
): string {
  return [
    ...(saved
      ? savedSummary(saved, draft, attachedMcps(saved, catalog))
      : draftSummary(draft, attachedMcps(draft, catalog))),
    '',
    ...STANDING_TASK,
    '',
    ...HOW_TO_NAME_TOOLS,
    ...buildCatalogDigest(catalog, skills, collections),
    '',
    ...SELECTION_DISCIPLINE,
    '',
    ...WHEN_SOMETHING_IS_UNAVAILABLE,
    '',
    ...(createdSlug ? howToUpdate(createdSlug) : HOW_TO_PROPOSE),
    '',
    ...STAY_IN_CHARACTER,
  ].join('\n');
}
