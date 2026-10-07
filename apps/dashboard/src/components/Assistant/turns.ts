import type { Message } from '../Chat/XyneAISidebar/utils/XyneAITypes';
import type { ActionDefinition } from './actions/action';
import { listOf, lowerFirst } from './engine/text';

// What the assistant puts in front of the user to tap, besides saying it.
export type AssistantCardData =
  | { kind: 'confirm'; summary: string }
  | { kind: 'choose'; options: readonly { id: string; label: string }[] };

export type CurrentCard = AssistantCardData & { messageId: string };

export interface AssistantTurn {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  at: Date;
  actions?: ActionDefinition[];
  opened?: string[];
  card?: AssistantCardData;
}

const MESSAGE_ID_PREFIX = 'assistant-';

const rank = (action: ActionDefinition): number => action.starter ?? Number.MAX_SAFE_INTEGER;

const byRank = (visible: readonly ActionDefinition[]): ActionDefinition[] =>
  [...visible].sort((a, b) => rank(a) - rank(b));

// Actions that share a rank are alternatives for one card: the first visible one is shown.
export const starterActions = (
  visible: readonly ActionDefinition[],
  limit = 3,
): ActionDefinition[] =>
  byRank(visible)
    .filter(
      (action, index, sorted) =>
        action.starter === undefined || action.starter !== sorted[index - 1]?.starter,
    )
    .slice(0, limit);

export const say = (
  role: AssistantTurn['role'],
  text: string,
  newId: () => string,
  card?: AssistantCardData,
): AssistantTurn => ({ id: newId(), role, text, at: new Date(), ...(card && { card }) });

// A card can be tapped only while its question is open, so a new reply takes the old ones back.
export const withoutCards = (turns: readonly AssistantTurn[]): AssistantTurn[] =>
  turns.map(({ card: _card, ...turn }) => turn);

export const currentCard = (turns: readonly AssistantTurn[]): CurrentCard | null => {
  const last = turns.at(-1);
  return last?.card ? { ...last.card, messageId: `${MESSAGE_ID_PREFIX}${last.id}` } : null;
};

// One action is opened right away, its pill ticked; several are left to pick from. `how`: the
// user asked how to do it, so its steps are said.
const replyTo = (
  actions: readonly ActionDefinition[],
  how = false,
): Pick<AssistantTurn, 'text' | 'actions' | 'opened'> => {
  const [only] = actions;
  return only && actions.length === 1
    ? {
        text:
          how && only.guide
            ? `Here's how to ${lowerFirst(only.title)}: ${only.guide.join(' ')}`
            : `Opening the page to ${lowerFirst(only.title)}.`,
        actions: [only],
        opened: [only.id],
      }
    : { text: 'Here is where to do each of these:', actions: [...actions] };
};

// It is said aloud, so it stays short.
const MAX_CAPABILITIES = 6;

// What the assistant says it can do, with those actions as pills to tap or say: the ranked ones
// the role sees, in rank order. Actions sharing a rank compete for a starter card, not for being
// listed. `back` is the open question of a request under way, put again in place of asking anew.
export const capabilities = (
  visible: readonly ActionDefinition[],
  back: string | null = null,
): Required<Pick<AssistantTurn, 'text' | 'actions'>> => {
  const actions = byRank(visible)
    .filter(action => action.starter !== undefined)
    .slice(0, MAX_CAPABILITIES);
  const listed = listOf(actions.map(({ title }) => lowerFirst(title)));
  return { text: `I can ${listed}. ${back ?? 'What would you like to do?'}`, actions };
};

export const exchange = (
  userText: string,
  actions: readonly ActionDefinition[],
  now: Date,
  newId: () => string,
  how = false,
): [AssistantTurn, AssistantTurn] => [
  { id: newId(), role: 'user', text: userText, at: now },
  { id: newId(), role: 'assistant', at: new Date(now.getTime() + 1), ...replyTo(actions, how) },
];

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

// Each local message sits after the server messages that were on screen when it first appeared.
// Placed by position, not timestamp: local times come from the browser clock and history from the server's.
export const mergeTranscript = (
  serverMessages: readonly Message[],
  localMessages: readonly Message[],
  positions: ReadonlyMap<string, number>,
): { messages: readonly Message[]; serverIndexById: ReadonlyMap<string, number> } => {
  const serverIndexById = new Map(serverMessages.map((message, index) => [message.id, index]));
  if (localMessages.length === 0) return { messages: serverMessages, serverIndexById };
  const messages: Message[] = [];
  let next = 0;
  for (let index = 0; index <= serverMessages.length; index++) {
    while (next < localMessages.length) {
      const local = localMessages[next];
      if (!local || (positions.get(local.id) ?? serverMessages.length) > index) break;
      messages.push(local);
      next++;
    }
    const server = serverMessages[index];
    if (server) messages.push(server);
  }
  return { messages: [...messages, ...localMessages.slice(next)], serverIndexById };
};
