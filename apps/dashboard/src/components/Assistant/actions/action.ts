// Mirrors core/action.ts of `@xyne/shared/assistant` (voice-assistant work): same names and
// meanings, and this file goes when that lands. Three things the shared schema lacks and must
// gain on merge: `hint` and `guide` on an action, and the `open_page` and `open_dialog`
// operations (the shared `navigate` only opens a conversation).

type Effect = 'read' | 'navigate' | 'send' | 'change';

type IntentDefinition = {
  description: string;
  examples: readonly string[];
  notFor?: readonly { when: string; instead: string }[];
};

export type PageId =
  | 'admin_invitations'
  | 'admin_organisations'
  | 'admin_general'
  | 'admin_members'
  | 'admin_guests'
  | 'admin_user_groups'
  | 'admin_roles'
  | 'chat_new_message'
  | 'chat_browse_channels'
  | 'ai_agent_create';

export type DialogId = 'add_channel';

export type PlanStep = { op: 'open_page'; page: PageId } | { op: 'open_dialog'; dialog: DialogId };

export type ActionDefinition = {
  id: string;
  title: string;
  hint?: string;
  guide?: readonly string[];
  intent: IntentDefinition;
  effect: Effect;
  fields: Record<string, never>;
  summarize: string;
  plan: readonly PlanStep[];
  done: string;
};

export type ActionArea = {
  id: string;
  description: string;
  actions: readonly ActionDefinition[];
};

export function intentCriteria(action: Pick<ActionDefinition, 'intent'>): string {
  const { description, examples, notFor = [] } = action.intent;
  const quoted = examples.map(example => `"${example}"`).join(', ');
  const exclusions = notFor.map(({ when, instead }) => `${when} (${instead})`).join('; ');
  return [description, `Examples: ${quoted}.`, exclusions && `Not for: ${exclusions}.`]
    .filter(Boolean)
    .join(' ');
}
