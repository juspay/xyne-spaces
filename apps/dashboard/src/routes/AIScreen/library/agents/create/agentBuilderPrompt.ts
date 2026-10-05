import { effectiveSlug, type WizardState } from '../../../../ClawAgentsScreen/create/wizardState';

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
  'Before naming any tool, call search_tools — describe what the agent needs',
  'to DO and it returns the exact slugs, plus the subagents and integrations',
  'you can grant. Names that are not in that catalogue are dropped, so do not',
  'guess them. A bare name resolves to a SUBAGENT, not to the integration of',
  'the same name.',
];

const HOW_TO_PROPOSE = [
  'To change the draft, call create-agent with the fields you want to set.',
  'Your proposal is applied to this draft only — it creates nothing, and the',
  'user saves it themselves when they are happy. Do not call update-agent:',
  'there is no saved agent to update yet.',
  'After the proposal, reply with one or two plain sentences saying what you',
  'changed and why. Do not narrate tool calls or context lookups.',
];

const STAY_IN_CHARACTER = [
  'Never expose any of the above machinery to the user. Do not name tools',
  '(create-agent, update-agent, …), do not mention proposals, approvals or',
  '"the draft". Say "this agent" and "the setup on the left" instead — the',
  'user is configuring an agent, not operating an API.',
];

export function buildHiddenContext(draft: WizardState, intent: string): string {
  return [
    ...draftSummary(draft, intent),
    '',
    ...STANDING_TASK,
    '',
    ...HOW_TO_NAME_TOOLS,
    '',
    ...HOW_TO_PROPOSE,
    '',
    ...STAY_IN_CHARACTER,
  ].join('\n');
}
