/** The slice of a navigator's state the card reads: routes, nested navigators, params. */
export type NavStateLike = Readonly<{
  index?: number | undefined;
  routes: readonly NavRouteLike[];
}>;
export type NavRouteLike = Readonly<{
  key: string;
  name: string;
  params?: object | undefined;
  state?: NavStateLike | undefined;
}>;

const isRoomRoute = (name: string): boolean =>
  name === '[channelId]' || name === '[channelId]/index';

/**
 * The route a nested navigator shows: from its state once it has one, else
 * from the `screen` it was opened with (a stack pushed once has no state of
 * its own yet, only its first screen in params).
 */
function frontOf(route: NavRouteLike): NavRouteLike | undefined {
  if (route.state && route.state.routes.length > 0) {
    const nested = route.state;
    return nested.routes[nested.index ?? nested.routes.length - 1];
  }
  const opened = route.params as { screen?: unknown; params?: unknown } | undefined;
  if (typeof opened?.screen !== 'string') return undefined;
  return {
    key: `${route.key}/${opened.screen}`,
    name: opened.screen,
    params: typeof opened.params === 'object' && opened.params !== null ? opened.params : undefined,
  };
}

/**
 * The room showing beneath the thread card (route `cardKey` in `state`): the
 * screen under it, followed down through nested navigators to the one in
 * front. Its channel id, or null when what is beneath is not a room
 * (Activity, Search, a call). The card names its room when the room is not
 * already there.
 */
export function roomBeneathCard(state: NavStateLike, cardKey: string): string | null {
  const at = state.routes.findIndex(route => route.key === cardKey);
  if (at <= 0) return null;
  let route: NavRouteLike | undefined = state.routes[at - 1];
  for (let next = route && frontOf(route); next; next = frontOf(next)) route = next;
  if (!route || !isRoomRoute(route.name)) return null;
  const channelId = (route.params as { channelId?: unknown } | undefined)?.channelId;
  return typeof channelId === 'string' ? channelId : null;
}
