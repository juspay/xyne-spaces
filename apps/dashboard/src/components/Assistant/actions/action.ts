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
  | 'add_channel'
  | 'ai_agent_create';

export type ActionDefinition = {
  id: string;
  title: string;
  hint?: string;
  guide?: readonly string[];
  intent: IntentDefinition;
  summarize: string;
  page: PageId;
};

export function intentCriteria(action: Pick<ActionDefinition, 'intent'>): string {
  const { description, examples, notFor = [] } = action.intent;
  const quoted = examples.map(example => `"${example}"`).join(', ');
  const exclusions = notFor.map(({ when, instead }) => `${when} (${instead})`).join('; ');
  return [description, `Examples: ${quoted}.`, exclusions && `Not for: ${exclusions}.`]
    .filter(Boolean)
    .join(' ');
}
