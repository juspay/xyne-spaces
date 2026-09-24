import { createBarItemsStore, type BarItemsStore } from './barItemsStore';

/**
 * The channel header's tabs, customized per channel.
 *
 * Every channel owns its own ordered list under `xyne:channel-tabs:<channelId>`,
 * because an app added inside one channel is almost never wanted in all of them
 * — which is exactly what the first, single-list version did.
 *
 * Only real channels (ChannelScopeType.DEFAULT, public and private alike) are
 * customizable; DMs, group DMs and ticket/document channels show the built-in
 * tabs and never reach this module. See `isChannelTabsCustomizable`.
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
