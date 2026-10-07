import {
  routeWithJev,
  type PendingField,
  type RouteResponse,
  type RouteTiming,
} from '../../services/assistantRouteService';
import { hiddenRouteActionOf, routeActionOf, type ActionDefinition } from './actions/action';

type FieldValues = Record<string, string>;

export type Route =
  | { kind: 'actions'; actions: ActionDefinition[]; fields: Record<string, FieldValues> }
  | { kind: 'unsure'; actions: ActionDefinition[]; fields: Record<string, FieldValues> }
  | { kind: 'answer'; fields: FieldValues }
  // `answering`: how likely the sentence answers the open question, when there is one.
  | { kind: 'ask_ai'; answering?: number }
  | { kind: 'no_access'; action: ActionDefinition } // one the user's role hides
  | { kind: 'unavailable' }; // Jev did not answer in time

const ASK_AI: Route = { kind: 'ask_ai' };

// The route, and how long deciding it took when a request was made.
export interface Routed {
  route: Route;
  timing?: RouteTiming;
}

// `hidden`: the actions the user's role hides, which Jev was told of as unavailable.
export const toRoute = (
  response: RouteResponse,
  actions: readonly ActionDefinition[],
  pending?: PendingField,
  hidden: readonly ActionDefinition[] = [],
): Route => {
  if (response.route === 'unavailable') return { kind: 'unavailable' };
  if (response.route === 'no_access') {
    const action = hidden.find(({ id }) => id === response.actionId);
    return action ? { kind: 'no_access', action } : ASK_AI;
  }
  if (response.route === 'answer') {
    return pending ? { kind: 'answer', fields: response.fields } : ASK_AI;
  }
  if (response.route === 'ask_ai') {
    return { kind: 'ask_ai', ...('answering' in response && { answering: response.answering }) };
  }
  if (response.route !== 'actions' && response.route !== 'unsure') return ASK_AI;
  const chosen = [...new Set(response.actionIds)].flatMap(id =>
    actions.filter(action => action.id === id),
  );
  return chosen.length > 0
    ? { kind: response.route, actions: chosen, fields: response.fields ?? {} }
    : ASK_AI;
};

export const routeText = async (
  text: string,
  actions: readonly ActionDefinition[],
  hidden: readonly ActionDefinition[],
  signal: AbortSignal,
  pending?: PendingField,
): Promise<Routed> => {
  if (actions.length === 0) return { route: ASK_AI };

  const { response, timing } = await routeWithJev(
    text,
    [...actions.map(routeActionOf), ...hidden.map(hiddenRouteActionOf)],
    signal,
    pending,
  );
  return { route: toRoute(response, actions, pending, hidden), timing };
};
