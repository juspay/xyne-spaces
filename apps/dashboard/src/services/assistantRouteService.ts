import { apiInstance } from './clients/apiClient';

interface RouteAction {
  id: string;
  description: string;
}

type RouteResponse =
  | { route: 'actions'; actionIds: string[]; confidence: number }
  | { route: 'ask_ai'; reason: 'none' | 'low_confidence' }
  | { route: 'unavailable' };

const UNAVAILABLE: RouteResponse = { route: 'unavailable' };

const isRouteResponse = (body: unknown): body is RouteResponse => {
  if (typeof body !== 'object' || body === null) return false;
  const value = body as Record<string, unknown>;
  switch (value['route']) {
    case 'actions':
      return (
        Array.isArray(value['actionIds']) &&
        value['actionIds'].every(id => typeof id === 'string') &&
        typeof value['confidence'] === 'number'
      );
    case 'ask_ai':
      return value['reason'] === 'none' || value['reason'] === 'low_confidence';
    case 'unavailable':
      return true;
    default:
      return false;
  }
};

// Never throws: any failure reads as `unavailable`.
export async function routeWithJev(
  text: string,
  actions: readonly RouteAction[],
  signal?: AbortSignal,
): Promise<RouteResponse> {
  try {
    const response = await apiInstance.post<unknown>(
      '/assistant/route',
      { text, actions },
      signal ? { signal } : undefined,
    );
    return isRouteResponse(response.data) ? response.data : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}
