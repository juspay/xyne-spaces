/**
 * Artifact apps live in the same ordered lists as a bar's built-in items, so
 * they need an id that cannot collide with a nav path (`/calls`), an Inbox key
 * (`threads`) or a channel tab value (`files`). The `app:` prefix is that
 * namespace; everything without it is a built-in.
 */

const APP_ITEM_PREFIX = 'app:';

export type AppItemId = `app:${string}`;

export const appItemId = (appId: string): AppItemId => `${APP_ITEM_PREFIX}${appId}`;

export const isAppItemId = (id: string): id is AppItemId => id.startsWith(APP_ITEM_PREFIX);

/** The bare app id, or null when `id` is a built-in. */
export const appIdOf = (id: string): string | null =>
  isAppItemId(id) ? id.slice(APP_ITEM_PREFIX.length) : null;
