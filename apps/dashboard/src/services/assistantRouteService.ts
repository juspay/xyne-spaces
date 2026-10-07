import type { FieldKind } from '../components/Assistant/actions/action';
import { apiInstance } from './clients/apiClient';

interface RouteField {
  describe: string;
  kind: FieldKind;
  options?: string[];
}

export interface RouteAction {
  id: string;
  description: string;
  fields?: Record<string, RouteField>;
  unavailable?: true; // hidden by the user's role: chosen only to say so
}

// The question the user's sentence is the answer to; no field when it is about the whole request.
export interface PendingField {
  action: string;
  field?: string;
  prompt: string;
}

// Values are spans of what the user said, or the label of a choice option.
type FieldValues = Record<string, string>;

// `answering`: with a question pending, how likely (0 to 1) the sentence answers it.
export type RouteResponse =
  | { route: 'actions'; actionIds: string[]; fields?: Record<string, FieldValues> }
  // Not sure enough to act: the actions the user may have meant, likeliest first.
  | { route: 'unsure'; actionIds: string[]; fields?: Record<string, FieldValues> }
  | { route: 'answer'; fields: FieldValues }
  | { route: 'ask_ai'; answering?: number }
  | { route: 'no_access'; actionId: string } // an action the user's role hides
  | { route: 'unavailable' };

const UNAVAILABLE: RouteResponse = { route: 'unavailable' };

// How long the request took here, and how much of that the backend spent routing: what is left is
// network, auth and proxy time. The backend reports it in a Server-Timing header.
export interface RouteTiming {
  ms: number;
  serverMs?: number;
}

// The backend sends Jev one request, bounded by its 5 s timeout. This is above it, so that
// timeout decides and this only covers the network.
const ROUTE_DEADLINE_MS = 5500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isProbability = (value: unknown): value is number =>
  typeof value === 'number' && value >= 0 && value <= 1;

const isFieldValues = (value: unknown): value is FieldValues =>
  isRecord(value) && Object.values(value).every(item => typeof item === 'string');

const isRouteResponse = (body: unknown): body is RouteResponse => {
  if (!isRecord(body)) return false;
  const { route, actionIds, actionId, fields, answering } = body;
  if (route === 'actions' || route === 'unsure') {
    return (
      Array.isArray(actionIds) &&
      actionIds.every(id => typeof id === 'string') &&
      (fields === undefined || (isRecord(fields) && Object.values(fields).every(isFieldValues)))
    );
  }
  if (route === 'answer') return isFieldValues(fields);
  if (route === 'ask_ai') return answering === undefined || isProbability(answering);
  if (route === 'no_access') return typeof actionId === 'string';
  return route === 'unavailable';
};

const serverMsOf = (header: unknown): number | undefined => {
  const match = typeof header === 'string' ? /route;dur=([\d.]+)/.exec(header) : null;
  return match?.[1] ? Number(match[1]) : undefined;
};

// Never throws: any failure reads as `unavailable`.
export async function routeWithJev(
  text: string,
  actions: readonly RouteAction[],
  signal: AbortSignal,
  pending?: PendingField,
): Promise<{ response: RouteResponse; timing: RouteTiming }> {
  const startedAt = performance.now();
  const elapsed = (): number => Math.round(performance.now() - startedAt);
  try {
    const response = await apiInstance.post<unknown>(
      '/assistant/route',
      { text, actions, ...(pending && { pending }) },
      { signal, timeout: ROUTE_DEADLINE_MS },
    );
    const serverMs = serverMsOf(response.headers['server-timing']);
    return {
      response: isRouteResponse(response.data) ? response.data : UNAVAILABLE,
      timing: { ms: elapsed(), ...(serverMs !== undefined && { serverMs }) },
    };
  } catch {
    return { response: UNAVAILABLE, timing: { ms: elapsed() } };
  }
}
