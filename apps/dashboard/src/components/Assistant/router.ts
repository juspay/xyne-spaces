import { routeWithJev } from '../../services/assistantRouteService';
import { intentCriteria, type ActionDefinition } from './actions/action';

type Route = { kind: 'actions'; actions: ActionDefinition[] } | { kind: 'ask_ai' };

const ASK_AI: Route = { kind: 'ask_ai' };

// Above the backend's 2.5 s Jev timeout, so that one decides and this only covers the network.
const ROUTE_DEADLINE_MS = 3000;

export const routeText = async (
  text: string,
  actions: readonly ActionDefinition[],
  signal: AbortSignal,
): Promise<Route> => {
  if (actions.length === 0) return ASK_AI;

  const response = await routeWithJev(
    text,
    actions.map(action => ({ id: action.id, description: intentCriteria(action) })),
    AbortSignal.any([signal, AbortSignal.timeout(ROUTE_DEADLINE_MS)]),
  );
  if (response.route !== 'actions') return ASK_AI;
  const chosen = response.actionIds.flatMap(id => actions.filter(action => action.id === id));
  return chosen.length > 0 ? { kind: 'actions', actions: chosen } : ASK_AI;
};
