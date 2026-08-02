import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findLatestMessageId, type ThreadCatchupMessages } from './ThreadCatchupSummary.utils';
import {
  fetchThreadRecommendation,
  fetchThreadSummary,
  type ThreadSummaryResponse,
} from './threadSummaryApi';

interface ThreadCatchupSummaryState {
  /** Whether the channel has the feature enabled (THREAD_SUMMARY_ENABLED_CHANNELS). */
  isAvailable: boolean;
  isRecommended: boolean;
  expanded: boolean;
  loading: boolean;
  /** The summary text to display — undefined if what we're holding is stale, even mid-refresh. */
  content: string | undefined;
  toggleExpanded: () => void;
  /** Bumps every time the panel opens (manual click or auto-recommend) — pass straight through to ThreadList's scrollToTrailingContentSignal so opening it scrolls it into view. */
  scrollSignal: number;
}

/**
 * Minimum number of UNREAD messages (from other people, since the user last read
 * this thread) before the recap is offered as a quiet, manually-openable tab. A
 * recap only earns its place once there's genuinely something to CATCH UP on —
 * keyed on unread, NOT total thread length, so a long thread you've already read
 * (or one with only a line or two of new activity) doesn't get a pointless recap.
 * (The "you were just added" auto-recommendation bypasses this, since the backend
 * only recommends when it already has a worthwhile summary.) Tune this to taste.
 */
const MIN_UNREAD_FOR_RECAP = 10;

interface CachedSummary {
  content: string;
  asOfMessageId: string;
}

function localStorageKey(
  userId: string | undefined,
  conversationId: string | undefined,
): string | undefined {
  return userId && conversationId ? `xyne:thread-summary:${userId}:${conversationId}` : undefined;
}

/** Per-user local cache of the last-fetched summary — purely a client-side redisplay optimization, not the source of truth (the backend's in-memory cache is). Swallows storage errors (quota, private browsing) since this is a nice-to-have, not critical. */
function readCachedSummary(key: string | undefined): CachedSummary | undefined {
  if (!key) return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CachedSummary>;
    if (typeof parsed.content === 'string' && typeof parsed.asOfMessageId === 'string') {
      return { content: parsed.content, asOfMessageId: parsed.asOfMessageId };
    }
  } catch {
    // malformed/corrupted entry — ignore, treat as no cache
  }
  return undefined;
}

function writeCachedSummary(key: string | undefined, value: CachedSummary): void {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // quota exceeded / private browsing — non-critical, just skip persisting
  }
}

/**
 * Drives the thread-summary UI: the always-on header button and the summary
 * panel itself — which
 * auto-opens (no Yes/No ask) for someone who was genuinely just added/
 * mentioned into the thread by someone else, and can also be toggled
 * manually via the header button any time.
 *
 * "Was I just added" is answered by a one-time backend flag
 * (fetchThreadRecommendation), set in real time by the actual
 * ConversationParticipant insert side effect — NOT inferred from
 * `lastReadAt`/`joinedAt` timestamps. That approach was tried first and
 * broke down: `lastReadAt` only updates via a client-side unmount effect
 * that doesn't reliably fire (hard refreshes, tab closes, etc. skip it), so
 * existing participants often look identical to genuinely new ones. The
 * real-time flag has no such ambiguity — it's set exactly once, at the
 * exact moment someone else's action adds this specific user.
 *
 * Storage model for the summary content itself: NOT a Message row — cached
 * in-process on the backend (dedupes LLM calls across users/visits) and
 * then persisted per-user in this browser's localStorage for instant
 * redisplay, keyed by `userId:conversationId`.
 *
 * ThreadPannel stays mounted across thread switches (nav updates props, not
 * a remount), so all state here must be explicitly reset when conversationId
 * changes — otherwise one thread's summary/expanded state leaks into the
 * next thread the user opens.
 */
export function useThreadCatchupSummary(
  conversationId: string | undefined,
  userId: string | undefined,
  messages: ThreadCatchupMessages | undefined,
  /** The user's lastReadAt for this thread (epoch ms; 0 if never read). Captured
   *  once at open to derive the unread count that gates the recap. */
  lastReadAt: number,
  isMessagesLoaded: boolean,
  isThreadParticipant: boolean,
): ThreadCatchupSummaryState {
  const latestMessageId = findLatestMessageId(messages);
  const storageKey = localStorageKey(userId, conversationId);

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | undefined>(undefined);
  // The messageId whatever's in `content` was actually generated from. Kept
  // separate from `content` itself so freshness can be re-checked on every
  // render against the current message list.
  const [contentAsOfMessageId, setContentAsOfMessageId] = useState<string | undefined>(undefined);
  // Whether the backend's one-time "you were just added" flag was set for
  // this user on this conversation.
  const [isFirstVisitWithSummary, setIsFirstVisitWithSummary] = useState(false);
  // Starts false (button hidden) until fetchThreadRecommendation's response
  // confirms this channel actually has the feature turned on — see the
  // THREAD_SUMMARY_ENABLED_CHANNELS rollout gate on the backend. Avoids a
  // show-then-hide flash for the (currently default) case of a channel
  // that's not enabled: the button just never appears rather than
  // appearing then vanishing once the check resolves.
  const [isFeatureEnabled, setIsFeatureEnabled] = useState(false);
  const [scrollSignal, setScrollSignal] = useState(0);
  const capturedRef = useRef(false);
  // Guards the once-per-thread background pre-generation (reset on conv change).
  const preGeneratedRef = useRef(false);
  // The user's lastReadAt captured at thread OPEN (not "now"), so the unread count
  // that gates the recap reflects "what I missed since last time" and doesn't
  // collapse to 0 as the user reads down the thread. null until first capture.
  const [unreadBaseline, setUnreadBaseline] = useState<number | null>(null);

  // Every transition into "open" — whether the user clicked the header
  // button or it auto-opened for a recommendation — bumps scrollSignal, so
  // ThreadList scrolls it into view. Closing doesn't (nothing to scroll to).
  useEffect(() => {
    if (expanded) setScrollSignal(s => s + 1);
  }, [expanded]);

  // Reset everything the instant conversationId changes, synchronously
  // during render (React's documented pattern for this) so no stale value
  // from the previous thread ever flashes on screen.
  const prevConversationIdRef = useRef(conversationId);
  if (prevConversationIdRef.current !== conversationId) {
    prevConversationIdRef.current = conversationId;
    setExpanded(false);
    setLoading(false);
    setContent(undefined);
    setContentAsOfMessageId(undefined);
    setIsFirstVisitWithSummary(false);
    setIsFeatureEnabled(false);
    setUnreadBaseline(null);
    capturedRef.current = false;
    preGeneratedRef.current = false;
  }

  const applyResult = useCallback(
    (result: ThreadSummaryResponse | null | undefined) => {
      setContent(result?.content);
      setContentAsOfMessageId(result?.asOfMessageId);
      if (result?.content && result.asOfMessageId) {
        writeCachedSummary(storageKey, {
          content: result.content,
          asOfMessageId: result.asOfMessageId,
        });
      }
    },
    [storageKey],
  );

  // On first load: show any locally-cached summary instantly, and check the
  // backend's one-time "you were just added" flag (consumed on read — see
  // threadSummaryService on the backend). A single request — the
  // backend bundles the summary content into this same response when
  // recommended, so there's no separate follow-up content fetch (and
  // nothing here to race against on the backend side).
  useEffect(() => {
    if (capturedRef.current || !isMessagesLoaded || !conversationId) return;
    capturedRef.current = true;

    // Snapshot the read position at open — before the user reads / the server
    // marks-read — so the unread count that gates the recap stays stable.
    setUnreadBaseline(lastReadAt);

    const cached = readCachedSummary(storageKey);
    if (cached) {
      setContent(cached.content);
      setContentAsOfMessageId(cached.asOfMessageId);
    }

    // Deliberately no `loading` state around this check — it fires on every
    // thread visit, and the vast majority aren't recommendations, so a
    // spinner here would flicker the header button on ordinary opens for no
    // reason. When it IS a recommendation, the content arrives in this same
    // response (see fetchThreadRecommendation), so `expanded` and `content`
    // land together — nothing is ever shown loading in between.
    fetchThreadRecommendation(conversationId)
      .then(({ recommended, enabled, summary }) => {
        setIsFeatureEnabled(enabled);
        setIsFirstVisitWithSummary(recommended);
        if (!recommended) return;
        setExpanded(true);
        applyResult(summary);
      })
      .catch(() => {
        setIsFeatureEnabled(false);
        setIsFirstVisitWithSummary(false);
      });
  }, [isMessagesLoaded, storageKey, conversationId, applyResult, lastReadAt]);

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const result = await fetchThreadSummary(conversationId);
      applyResult(result);
    } finally {
      setLoading(false);
    }
  }, [conversationId, applyResult]);

  const toggleExpanded = useCallback(() => {
    setExpanded(value => !value);
  }, []);

  // Only used to decide whether an *open* needs a fetch, not whether to keep
  // displaying what we already have — see the effect below.
  const isContentFresh =
    contentAsOfMessageId !== undefined && contentAsOfMessageId === latestMessageId;

  // Fetch exactly once per open (closed -> open transition), not on every
  // subsequent message while it stays open. Once someone's read a summary,
  // the backend tears its cache down (see deleteCachedSummary) precisely so
  // nobody keeps paying to regenerate it for an audience that's moved on —
  // the viewer sending another message of their own while the panel happens
  // to still be open shouldn't force a fresh regeneration. Closing and
  // reopening (or the header button) does, since that's a new open.
  const hasFetchedForOpenRef = useRef(false);
  useEffect(() => {
    if (!expanded) {
      hasFetchedForOpenRef.current = false;
      return;
    }
    if (hasFetchedForOpenRef.current) return;
    hasFetchedForOpenRef.current = true;
    if (!isContentFresh && !loading) {
      void refresh();
    }
  }, [expanded, isContentFresh, loading, refresh]);

  // How many messages from OTHERS landed since I last read this thread (my own
  // messages aren't something I need to "catch up" on). Keyed on unread — NOT the
  // total thread length — and off the baseline captured at open, so it's the
  // count of what I actually missed. Zero until the baseline is captured.
  const unreadFromOthers = useMemo(() => {
    if (unreadBaseline === null || messages === undefined) return 0;
    let count = 0;
    for (const m of messages) {
      if (m.senderId === userId) continue;
      if (new Date(m.createdAt).getTime() > unreadBaseline) count += 1;
    }
    return count;
  }, [messages, userId, unreadBaseline]);
  const hasEnoughUnread = unreadFromOthers >= MIN_UNREAD_FOR_RECAP;

  // Did I send the most recent message? Then I've engaged with the thread —
  // there's nothing to "catch up" on, so the recap retires. This is what makes
  // it disappear once I reply (the shared server-side summary stays for other
  // users who haven't caught up; this only gates MY view).
  const userSentLatest =
    !!userId &&
    messages !== undefined &&
    messages.length > 0 &&
    messages[messages.length - 1]?.senderId === userId;

  // Recap is offered when the channel has the feature on, I HAVEN'T just replied,
  // AND either the backend recommended it (I was just added — so I'm now in the
  // thread) OR I'm a participant with ENOUGH UNREAD to be worth catching up on.
  // This keeps the recap off short / already-caught-up / not-mine threads while
  // preserving the auto-recommend flow for people freshly pulled in.
  const isAvailable =
    isFeatureEnabled &&
    !userSentLatest &&
    (isFirstVisitWithSummary || (isThreadParticipant && hasEnoughUnread));

  // PRE-GENERATE the moment the recap becomes available for this thread — i.e.
  // on thread open, NOT only when the Recap tab is opened — so switching to the
  // tab shows a ready summary instead of a 10s+ spinner. Fires once per thread
  // (preGeneratedRef reset on conversation change); the server-side cache dedupes
  // across users/visits so this stays cheap.
  useEffect(() => {
    if (preGeneratedRef.current || !isAvailable || !isMessagesLoaded) return;
    preGeneratedRef.current = true;
    if (!isContentFresh && !loading) void refresh();
  }, [isAvailable, isMessagesLoaded, isContentFresh, loading, refresh]);

  return {
    isAvailable,
    isRecommended: isAvailable && isFirstVisitWithSummary,
    expanded,
    loading,
    content,
    toggleExpanded,
    scrollSignal,
  };
}
