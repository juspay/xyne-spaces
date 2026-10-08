import { apiInstance } from './clients/apiClient';

interface RouteAction {
  id: string;
  description: string;
}

// Jev's top pick and its share of the vote.
interface JevPick {
  chosen?: string;
  probability?: number;
}

type RouteResponse =
  | ({ route: 'actions'; actionIds: string[] } & JevPick)
  | ({ route: 'ask_ai' } & JevPick)
  | { route: 'unavailable' };

const UNAVAILABLE: RouteResponse = { route: 'unavailable' };

// Above the backend's 2.5 s Jev timeout, so that one decides and this only covers the network.
const ROUTE_DEADLINE_MS = 3000;

const isRouteResponse = (body: unknown): body is RouteResponse => {
  if (typeof body !== 'object' || body === null) return false;
  const { route, actionIds } = body as Record<string, unknown>;
  if (route === 'actions') {
    return Array.isArray(actionIds) && actionIds.every(id => typeof id === 'string');
  }
  return route === 'ask_ai' || route === 'unavailable';
};

// Never throws: any failure reads as `unavailable`.
export async function routeWithJev(
  text: string,
  actions: readonly RouteAction[],
  signal: AbortSignal,
  mode?: 'screen',
): Promise<RouteResponse> {
  try {
    const response = await apiInstance.post<unknown>(
      '/assistant/route',
      { text, actions, mode },
      { signal, timeout: ROUTE_DEADLINE_MS },
    );
    return isRouteResponse(response.data) ? response.data : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}
