import { routeWithJev } from '../../services/assistantRouteService';
import { intentCriteria, type ActionDefinition } from './actions/action';

type Route = { kind: 'actions'; actions: ActionDefinition[] } | { kind: 'ask_ai' };

const ASK_AI: Route = { kind: 'ask_ai' };

const MAX_ACTIONS = 250;

const ROUTE_DEADLINE_MS = 2000;

const askJev = async (
  text: string,
  actions: readonly ActionDefinition[],
  signal: AbortSignal,
): Promise<Route> => {
  const sent = actions
    .slice(0, MAX_ACTIONS)
    .map(action => ({ id: action.id, description: intentCriteria(action) }));
  const response = await routeWithJev(text, sent, signal);
  if (response.route !== 'actions') return ASK_AI;
  const chosen = response.actionIds.flatMap(id => actions.filter(action => action.id === id));
  return chosen.length > 0 ? { kind: 'actions', actions: chosen } : ASK_AI;
};

export const routeText = async (
  text: string,
  actions: readonly ActionDefinition[],
  signal: AbortSignal,
): Promise<Route> => {
  if (actions.length === 0) return ASK_AI;

  const controller = new AbortController();
  const abort = (): void => controller.abort();
  signal.addEventListener('abort', abort);
  if (signal.aborted) abort();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<Route>(resolve => {
    timer = setTimeout(() => {
      abort();
      resolve(ASK_AI);
    }, ROUTE_DEADLINE_MS);
  });
  try {
    return await Promise.race([askJev(text, actions, controller.signal), deadline]);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
};
