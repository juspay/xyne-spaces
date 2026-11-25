/** The thread card at the app's root, over whatever screen opened it. */
export const THREAD_CARD_ROUTE = '/thread/[channelId]/[threadId]';
/** The thread inside the chat stack: the old screen, and cold notification opens. */
export const CHAT_THREAD_ROUTE = '/chat/[channelId]/[threadId]';

export type ThreadRoutePathname = typeof THREAD_CARD_ROUTE | typeof CHAT_THREAD_ROUTE;

/**
 * Whether threads open as the root card. Set by the app shell as it mounts,
 * from the flag snapshot it pins (a flag change remounts the shell), so this
 * module stays free of the flag runtime and the navigation code that reads it
 * stays testable in node.
 */
let threadCardRoute = false;

export function setThreadCardRoute(enabled: boolean): void {
  threadCardRoute = enabled;
}

/**
 * Where an in-app tap opens a thread: the root card while the redesigned card
 * is on, else the chat stack's thread.
 */
export function threadRoutePathname(): ThreadRoutePathname {
  return threadCardRoute ? THREAD_CARD_ROUTE : CHAT_THREAD_ROUTE;
}
