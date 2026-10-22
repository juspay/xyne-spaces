// Cmd+K open-size policy (pure, persisted): learned modal/full default, quick-return restore,
// return banner and the full-page snackbar. Cmd+F never teaches it; the collapse button resets it
// to modal, Back does not.
import { z } from 'zod';
import type { StoredRecentSearch } from '../components/Chat/ChatDirectory/RecentSearches/storage';

// ─── Public contract ────────────────────────────────────────────────────────

export type CmdkSize = 'modal' | 'full';

/**
 * How the palette session was opened. `findInChannel` is Cmd+F: it is scoped to the current
 * channel, so its sessions never teach the open-size policy.
 */
export type CmdkOpenOrigin = 'search' | 'findInChannel';

/** The query a result was opened from, stored the way recent searches store it (chip ids only). */
export type CmdkReturnQuery = Omit<StoredRecentSearch, 'ts'>;

export interface CmdkLastResultOpen {
  /** Epoch ms when the result was opened. */
  at: number;
  query: CmdkReturnQuery;
}

export interface CmdkPolicyState {
  preferredSize: CmdkSize;
  /** Consecutive sessions that ended in full page, counted up to the streak that switches. */
  fullStreak: number;
  /**
   * 1 once search has been shown full page, ever (0 before): any use retires the banner for good.
   */
  fullPageUses: number;
  /** Times the return banner was shown, counted up to the max. */
  bannerShows: number;
  lastResultOpen: CmdkLastResultOpen | null;
  /** The default just switched to full page; announce it on the next full-page open. */
  announceFull: boolean;
  /** The switch to full page has been announced once; later switches go unannounced. */
  fullAnnounced: boolean;
}

export interface CmdkPolicyOptions {
  /** How long after opening a result a Cmd+K reopen counts as returning; 0 turns the return off. */
  returnWindowMs: number;
  /** Consecutive full-page sessions that switch the default to full page. */
  fullPageStreak: number;
  /** How many times the return banner may be shown; 0 turns it off. */
  maxBannerShows: number;
}

export const DEFAULT_CMDK_POLICY_OPTIONS: CmdkPolicyOptions = {
  returnWindowMs: 15_000,
  fullPageStreak: 2,
  // Up to 5 reminders that full page exists, for as long as the user has never used it.
  maxBannerShows: 5,
};

export const DEFAULT_CMDK_POLICY_STATE: CmdkPolicyState = {
  preferredSize: 'modal',
  fullStreak: 0,
  fullPageUses: 0,
  bannerShows: 0,
  lastResultOpen: null,
  announceFull: false,
  fullAnnounced: false,
};

/** What an open should look like, plus the state to persist once it has happened. */
export interface CmdkOpenDecision {
  state: CmdkPolicyState;
  size: CmdkSize;
  /** The query to restore, or null to open empty. */
  restore: CmdkLastResultOpen | null;
  /**
   * The return banner may show. The palette still hides it while the restored query has no
   * results, and calls {@link onBannerShown} only once it is actually on screen.
   */
  bannerEligible: boolean;
  /** Show the "Search now opens in full page" snackbar. */
  announceFullPage: boolean;
}

// ─── Transitions ────────────────────────────────────────────────────────────

/**
 * Decide how Cmd+K opens right now, consuming the one-shot restore and announcement. `size` holds
 * this open to a size (the modal, over an open dialog) without changing the learned default.
 */
export function openCmdk(
  state: CmdkPolicyState,
  now: number,
  options: CmdkPolicyOptions,
  size: CmdkSize = state.preferredSize,
): CmdkOpenDecision {
  const restore = isReturning(state, now, options) ? state.lastResultOpen : null;
  const bannerEligible =
    restore !== null &&
    size === 'modal' &&
    state.fullPageUses === 0 &&
    state.bannerShows < options.maxBannerShows;
  const announceFullPage = size === 'full' && state.announceFull;

  return {
    state: {
      ...state,
      // Past the window the stored query is stale, so every open drops it.
      lastResultOpen: null,
      announceFull: announceFullPage ? false : state.announceFull,
      fullAnnounced: state.fullAnnounced || announceFullPage,
      fullPageUses: size === 'full' ? FULL_PAGE_USED : state.fullPageUses,
    },
    size,
    restore,
    bannerEligible,
    announceFullPage,
  };
}

/** The return banner is on screen; each show counts toward the max, dismissed or not. */
export const onBannerShown = (
  state: CmdkPolicyState,
  options: CmdkPolicyOptions,
): CmdkPolicyState => ({
  ...state,
  bannerShows: countUpTo(state.bannerShows, options.maxBannerShows),
});

/** The modal expanded to full page (expand row, banner, header icon or shortcut). */
export const onExpandToFull = (state: CmdkPolicyState): CmdkPolicyState => ({
  ...state,
  fullPageUses: FULL_PAGE_USED,
});

/**
 * Full page collapsed to the modal, or the snackbar's Undo: the default goes back to modal
 * immediately, whatever the streak was.
 */
export const onCollapseToModal = (state: CmdkPolicyState): CmdkPolicyState => ({
  ...state,
  preferredSize: 'modal',
  fullStreak: 0,
  announceFull: false,
});

/** A result was opened from the palette; remember the query for a quick return. */
export const onResultOpened = (
  state: CmdkPolicyState,
  now: number,
  query: CmdkReturnQuery,
): CmdkPolicyState => ({
  ...state,
  lastResultOpen: { at: now, query },
});

/**
 * The palette closed. `endedIn` is the size it closed at, so a session that expanded and then
 * collapsed counts as a modal session.
 */
export function onSessionEnd(
  state: CmdkPolicyState,
  endedIn: CmdkSize,
  origin: CmdkOpenOrigin,
  options: CmdkPolicyOptions,
): CmdkPolicyState {
  if (origin === 'findInChannel') return state;
  if (endedIn === 'modal') return { ...state, fullStreak: 0 };

  const fullStreak = countUpTo(state.fullStreak, options.fullPageStreak);
  const switchesToFull = state.preferredSize === 'modal' && fullStreak >= options.fullPageStreak;
  return {
    ...state,
    fullStreak,
    preferredSize: switchesToFull ? 'full' : state.preferredSize,
    announceFull: switchesToFull ? !state.fullAnnounced : state.announceFull,
  };
}

// ─── Persistence ────────────────────────────────────────────────────────────

/** Read the policy for this user+workspace; anything missing or malformed reads as the default. */
export function loadCmdkPolicy(workspaceId: string, userId: string): CmdkPolicyState {
  if (!workspaceId || !userId) return { ...DEFAULT_CMDK_POLICY_STATE };
  try {
    const stored = localStorage.getItem(buildStorageKey(workspaceId, userId));
    if (!stored) return { ...DEFAULT_CMDK_POLICY_STATE };

    const parsed = envelopeSchema.safeParse(JSON.parse(stored));
    return parsed.success ? parsed.data.state : { ...DEFAULT_CMDK_POLICY_STATE };
  } catch {
    return { ...DEFAULT_CMDK_POLICY_STATE };
  }
}

export function saveCmdkPolicy(workspaceId: string, userId: string, state: CmdkPolicyState): void {
  if (!workspaceId || !userId) return;
  try {
    const envelope = { version: STORAGE_VERSION, state };
    localStorage.setItem(buildStorageKey(workspaceId, userId), JSON.stringify(envelope));
  } catch {
    // Storage full or blocked: the palette still works, it just won't remember this session.
  }
}

// ─── Internals ──────────────────────────────────────────────────────────────

const STORAGE_VERSION = 1;

// Counters only ever count as far as the decision reading them needs, so a long-lived user's
// stored state stays bounded: past its limit a counter means nothing more.
const countUpTo = (count: number, limit: number): number => Math.min(count + 1, Math.max(limit, 0));

// fullPageUses only answers "has full page ever been used".
const FULL_PAGE_USED = 1;

// localStorage key, scoped per workspace + user like recent searches, so a restored query's
// chips always belong to the workspace they are restored into.
const buildStorageKey = (workspaceId: string, userId: string): string =>
  `cmdk-policy:${workspaceId}:${userId}`;

// A clock that moved backwards (at > now) is not a return.
const isReturning = (state: CmdkPolicyState, now: number, options: CmdkPolicyOptions): boolean =>
  options.returnWindowMs > 0 &&
  state.lastResultOpen !== null &&
  now >= state.lastResultOpen.at &&
  now - state.lastResultOpen.at <= options.returnWindowMs;

const isReturnQuery = (value: unknown): value is CmdkReturnQuery => {
  if (!value || typeof value !== 'object') return false;
  const query = value as Partial<CmdkReturnQuery>;
  return (
    typeof query.text === 'string' &&
    typeof query.tab === 'string' &&
    Array.isArray(query.filterChips) &&
    typeof query.toggles === 'object' &&
    query.toggles !== null
  );
};

// Every field falls back on its own, so one bad value never costs the rest of the state.
const countSchema = z.number().int().nonnegative().catch(0);

const envelopeSchema = z.object({
  version: z.literal(STORAGE_VERSION),
  state: z.object({
    preferredSize: z.enum(['modal', 'full']).catch('modal'),
    fullStreak: countSchema,
    // Stored as a running count before it only meant "used at all".
    fullPageUses: countSchema.transform(uses => Math.min(uses, FULL_PAGE_USED)),
    bannerShows: countSchema,
    lastResultOpen: z
      .object({
        at: z.number(),
        query: z.custom<CmdkReturnQuery>(isReturnQuery),
      })
      .nullable()
      .catch(null),
    announceFull: z.boolean().catch(false),
    fullAnnounced: z.boolean().catch(false),
  }),
});
