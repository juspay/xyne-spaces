import { apiInstance } from './clients/apiClient';

interface RouteAction {
  id: string;
  description: string;
}

interface JevPick {
  chosen?: string;
  probability?: number;
}

type RouteResponse =
  | ({ route: 'actions'; actionIds: string[] } & JevPick)
  | ({ route: 'ask_ai' } & JevPick)
  | { route: 'unavailable' };

const UNAVAILABLE: RouteResponse = { route: 'unavailable' };

// Above the backend's 5 s Jev timeout, so that one decides and this only covers the network.
const ROUTE_DEADLINE_MS = 6000;

const isRouteResponse = (body: unknown): body is RouteResponse => {
  if (typeof body !== 'object' || body === null) return false;
  const { route, actionIds, probability, chosen } = body as Record<string, unknown>;
  if (probability !== undefined && typeof probability !== 'number') return false;
  if (chosen !== undefined && typeof chosen !== 'string') return false;
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
  mode?: 'screen' | 'check',
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
