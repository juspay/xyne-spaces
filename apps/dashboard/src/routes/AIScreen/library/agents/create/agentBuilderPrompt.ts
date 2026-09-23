import { effectiveSlug, type WizardState } from '../../../../ClawAgentsScreen/create/wizardState';

export function buildSeedQuery(draft: WizardState): string {
  const name = draft.name.trim();
  const intent = draft.systemPrompt.trim();
  const subject = name || 'this agent';
  const purpose = intent && intent !== name ? ` — ${intent}` : '';
  return `Set up “${subject}”${purpose}`;
}

function draftSummary(draft: WizardState): string[] {
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
    `Tools: ${tools.join(', ') || '(none)'}`,
  ];
}

const STANDING_TASK = [
  'Your standing task: refine the instructions and suggest the tools this',
  'agent needs. The opening message carries only the intent — this is what',
  'the user is asking you to do with it.',
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

export function buildHiddenContext(draft: WizardState): string {
  return [
    ...draftSummary(draft),
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
