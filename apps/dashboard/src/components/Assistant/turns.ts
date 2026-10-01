import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import type { ActionDefinition } from './actions/action';

export interface AssistantTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: Date;
  actions?: ActionDefinition[];
  opened?: string[];
}

const MESSAGE_ID_PREFIX = 'assistant-';

const ADMIN_STARTER_IDS = ['invite_people', 'create_agent', 'create_channel'];
const MEMBER_STARTER_IDS = ['start_chat', 'create_agent', 'create_channel'];

export const starterActions = (
  visible: readonly ActionDefinition[],
  isAdmin: boolean,
  limit = 3,
): ActionDefinition[] => {
  const ids = isAdmin ? ADMIN_STARTER_IDS : MEMBER_STARTER_IDS;
  const starters = ids.flatMap(id => visible.filter(action => action.id === id));
  const rest = visible.filter(action => !starters.includes(action));
  return [...starters, ...rest].slice(0, limit);
};

const lowerFirst = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

const replyTo = (
  actions: readonly ActionDefinition[],
): { text: string; actions: ActionDefinition[] } => {
  const [only] = actions;
  if (actions.length !== 1 || !only) {
    return { text: 'Here is where to do each of these:', actions: [...actions] };
  }
  const steps = (only.guide ?? []).map((step, index) => `${index + 1}. ${step}`);
  const lead =
    steps.length > 0
      ? `To ${lowerFirst(only.title)}, ${lowerFirst(only.summarize)}:`
      : `${only.summarize}.`;
  return { text: [lead, ...steps].join('\n\n'), actions: [only] };
};

export const exchange = (
  userText: string,
  actions: readonly ActionDefinition[],
  now: Date,
  newId: () => string,
): [AssistantTurn, AssistantTurn] => {
  const reply = replyTo(actions);
  return [
    { id: newId(), role: 'user', text: userText, at: now },
    {
      id: newId(),
      role: 'assistant',
      text: reply.text,
      at: new Date(now.getTime() + 1),
      actions: reply.actions,
    },
  ];
};

const VISITED = '✓ ';

export const toChatMessages = (turns: readonly AssistantTurn[]): Message[] =>
  turns.map(turn => ({
    id: `${MESSAGE_ID_PREFIX}${turn.id}`,
    type: turn.role === 'user' ? 'user' : 'bot',
    content: turn.text,
    timestamp: turn.at,
    ...(turn.actions?.length
      ? {
          followUpSuggestions: turn.actions.map(action =>
            turn.opened?.includes(action.id) ? `${VISITED}${action.title}` : action.title,
          ),
        }
      : {}),
  }));

export const markOpened = (
  turns: readonly AssistantTurn[],
  messageId: string,
  actionId: string,
): AssistantTurn[] =>
  turns.map(turn =>
    `${MESSAGE_ID_PREFIX}${turn.id}` === messageId && !turn.opened?.includes(actionId)
      ? { ...turn, opened: [...(turn.opened ?? []), actionId] }
      : turn,
  );

export const isAssistantMessage = (messageId: string): boolean =>
  messageId.startsWith(MESSAGE_ID_PREFIX);

export const pillAction = (
  turns: readonly AssistantTurn[],
  messageId: string,
  label: string,
): ActionDefinition | undefined => {
  const title = label.startsWith(VISITED) ? label.slice(VISITED.length) : label;
  return turns
    .find(turn => `${MESSAGE_ID_PREFIX}${turn.id}` === messageId)
    ?.actions?.find(action => action.title === title);
};

export const mergeTranscript = (
  serverMessages: readonly Message[],
  localMessages: readonly Message[] = [],
): { messages: readonly Message[]; serverIndexById: ReadonlyMap<string, number> } => ({
  messages:
    localMessages.length === 0
      ? serverMessages
      : [...serverMessages, ...localMessages].sort(
          (left, right) => left.timestamp.getTime() - right.timestamp.getTime(),
        ),
  serverIndexById: new Map(serverMessages.map((message, index) => [message.id, index])),
});
