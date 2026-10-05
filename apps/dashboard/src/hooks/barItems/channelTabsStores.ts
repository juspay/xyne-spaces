import { useMemo } from 'react';
import { parsePublishedAppIds } from '@xyne/shared';
import { createBarItemsStore, type BarItemsStore } from './barItemsStore';
import { isAppItemId } from './appItemId';
import { mergeChannelTabs, splitChannelTabs, type ChannelTabLayers } from './channelTabLayers';

/**
 * The channel header's tabs, customized per channel.
 *
 * Every channel owns its own ordered list under `xyne:channel-tabs:<channelId>`,
 * because an app added inside one channel is almost never wanted in all of them
 * — which is exactly what the first, single-list version did.
 *
 * Only real channels (ChannelScopeType.DEFAULT, public and private alike, and
 * never a desk) are customizable; DMs, group DMs, ticket/document channels and
 * desks show the built-in tabs and never reach this module. See
 * `isChannelTabsCustomizable`.
 *
 * On top of that list sit the apps a channel admin published
 * (Channel.publishedAppIds). Two more local lists per channel record how this
 * member relates to them — `:added` (apps they added themselves) and `:hidden`
 * (published apps they removed) — and `useChannelTabsStore` merges the three
 * into what the member sees. See channelTabLayers.ts.
 */

/** Canonical order, and what an uncustomized channel shows. */
export const DEFAULT_CHANNEL_TABS = [
  'messages',
  'files',
  'pins',
  'canvas',
  'links',
  'tickets',
] as const;

/** `messages` is the fallback for any unknown `?tab=` and holds the composer. */
const LOCKED_CHANNEL_TABS = ['messages'];

const CHANNEL_TABS_KEY_PREFIX = 'xyne:channel-tabs:';
// Deliberately not `…-tabs:default`, which a channel whose id were literally
// "default" would collide with.
const CHANNEL_TABS_DEFAULT_KEY = 'xyne:channel-tabs-default';
// The pre-per-channel key: one list shared by every channel.
const LEGACY_GLOBAL_KEY = 'xyne:channel-tabs';

const readList = (key: string): string[] | null => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.every(v => typeof v === 'string') ? parsed : null;
  } catch {
    return null;
  }
};

/**
 * What a channel starts with. The old global list becomes that starting layout
 * rather than being discarded: it is what the user currently sees in every
 * channel, apps included, so dropping it would look like the tabs reset
 * themselves. Read once at module load — a default that changed mid-session
 * would make two channels disagree about what "uncustomized" means.
 */
const resolveDefaults = (): string[] => {
  const legacy = readList(LEGACY_GLOBAL_KEY);
  if (legacy) {
    try {
      localStorage.setItem(CHANNEL_TABS_DEFAULT_KEY, JSON.stringify(legacy));
      localStorage.removeItem(LEGACY_GLOBAL_KEY);
    } catch {
      // Storage unavailable; the in-memory value below still applies this session.
    }
    return legacy;
  }
  return readList(CHANNEL_TABS_DEFAULT_KEY) ?? [...DEFAULT_CHANNEL_TABS];
};

const channelTabDefaults = resolveDefaults();

// One store per channel, created on first use. A Map, not an object: the key is
// a channel id off the URL, and a plain object would make that untrusted string
// a property name. Stores are tiny closures and only the channels visited this
// session are here, so nothing needs evicting.
const stores = new Map<string, BarItemsStore>();

/**
 * This channel's tab store. Always returns the same instance for the same id,
 * which is what keeps `useSyncExternalStore`'s subscribe identity stable across
 * renders — a fresh store per render would resubscribe on every pass.
 */
export const getChannelTabsStore = (channelId: string): BarItemsStore => {
  const existing = stores.get(channelId);
  if (existing) return existing;
  const store = createBarItemsStore({
    storageKey: `${CHANNEL_TABS_KEY_PREFIX}${channelId}`,
    defaults: channelTabDefaults,
    locked: LOCKED_CHANNEL_TABS,
  });
  stores.set(channelId, store);
  return store;
};

const addedStores = new Map<string, BarItemsStore>();
const hiddenStores = new Map<string, BarItemsStore>();

/**
 * Apps this member added to the channel themselves. The first read seeds it
 * with every app already in the channel's list: before publishing existed,
 * every app there was one the member added, so it must stay theirs.
 */
const getAddedStore = (channelId: string): BarItemsStore => {
  const existing = addedStores.get(channelId);
  if (existing) return existing;
  const store = createBarItemsStore({
    storageKey: `${CHANNEL_TABS_KEY_PREFIX}${channelId}:added`,
    defaults: [],
    migrate: () => getChannelTabsStore(channelId).get().filter(isAppItemId),
  });
  addedStores.set(channelId, store);
  return store;
};

/** Published apps this member removed for themselves. */
const getHiddenStore = (channelId: string): BarItemsStore => {
  const existing = hiddenStores.get(channelId);
  if (existing) return existing;
  const store = createBarItemsStore({
    storageKey: `${CHANNEL_TABS_KEY_PREFIX}${channelId}:hidden`,
    defaults: [],
  });
  hiddenStores.set(channelId, store);
  return store;
};

/**
 * This channel's tabs as this member sees them: the admin's published apps with
 * the member's own order, additions and removals applied.
 *
 * Same `BarItemsStore` interface as every other bar, so SortableBar, the "+"
 * menu, the hover "×", Preferences and the header's edit/cancel all work
 * unchanged. Every write goes through `set(visibleList)`, which splits the list
 * back into the three local layers — that is what makes the header's Cancel
 * (`set(snapshot)`) restore hidden and self-added state exactly.
 *
 * `publishedAppIdsRaw` is the channel row's column as synced by Zero.
 */
export const useChannelTabsStore = (
  channelId: string,
  publishedAppIdsRaw: string | null | undefined,
): BarItemsStore =>
  useMemo((): BarItemsStore => {
    const published = parsePublishedAppIds(publishedAppIdsRaw);
    const order = getChannelTabsStore(channelId);
    const added = getAddedStore(channelId);
    const hidden = getHiddenStore(channelId);

    const layers = (): ChannelTabLayers => ({
      order: order.get(),
      added: added.get(),
      hidden: hidden.get(),
    });
    const get = (): readonly string[] => mergeChannelTabs(layers(), published);
    const set = (ids: readonly string[]): void => {
      const next = splitChannelTabs(ids, published, layers());
      order.set(next.order);
      added.set(next.added);
      hidden.set(next.hidden);
    };

    return {
      locked: order.locked,
      useItems: (): readonly string[] => {
        const orderIds = order.useItems();
        const addedIds = added.useItems();
        const hiddenIds = hidden.useItems();
        return useMemo(
          () =>
            mergeChannelTabs({ order: orderIds, added: addedIds, hidden: hiddenIds }, published),
          [orderIds, addedIds, hiddenIds],
        );
      },
      get,
      has: (id): boolean => get().includes(id),
      add: (id, at): void => {
        const current = get();
        if (current.includes(id)) return;
        const next = [...current];
        if (at === undefined || at < 0 || at > next.length) next.push(id);
        else next.splice(at, 0, id);
        set(next);
      },
      remove: (id): void => {
        if (order.locked.includes(id)) return;
        const current = get();
        if (current.includes(id)) set(current.filter(x => x !== id));
      },
      move: (from, to): void => {
        const current = get();
        if (from === to || from < 0 || to < 0 || from >= current.length || to >= current.length) {
          return;
        }
        const next = [...current];
        const [moved] = next.splice(from, 1);
        if (moved === undefined) return;
        next.splice(to, 0, moved);
        set(next);
      },
      set,
      // Back to the channel's layout: the default tabs plus whatever is published.
      reset: (): void => {
        order.reset();
        added.set([]);
        hidden.set([]);
      },
    };
  }, [channelId, publishedAppIdsRaw]);
