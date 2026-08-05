import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { findLatestMessageId, type ThreadCatchupMessages } from './ThreadCatchupSummary.utils';
import {
  fetchThreadRecommendation,
  fetchThreadSummary,
  type ThreadSummaryResponse,
} from './threadSummaryApi';

interface ThreadCatchupSummaryState {
  isAvailable: boolean;
  isRecommended: boolean;
  expanded: boolean;
  loading: boolean;
  content: string | undefined;
  toggleExpanded: () => void;
  scrollSignal: number;
}

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

function readCachedSummary(key: string | undefined): CachedSummary | undefined {
  if (!key) return undefined;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Partial<CachedSummary>;
    if (typeof parsed.content === 'string' && typeof parsed.asOfMessageId === 'string') {
      return { content: parsed.content, asOfMessageId: parsed.asOfMessageId };
    }
  } catch { /* ignore */ }
  return undefined;
}

function writeCachedSummary(key: string | undefined, value: CachedSummary): void {
  if (!key) return;
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch { /* ignore */ }
}

export function useThreadCatchupSummary(
  conversationId: string | undefined,
  userId: string | undefined,
  messages: ThreadCatchupMessages | undefined,
  lastReadAt: number,
  isMessagesLoaded: boolean,
  isThreadParticipant: boolean,
): ThreadCatchupSummaryState {
  const latestMessageId = findLatestMessageId(messages);
  const storageKey = localStorageKey(userId, conversationId);

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [content, setContent] = useState<string | undefined>(undefined);
  const [contentAsOfMessageId, setContentAsOfMessageId] = useState<string | undefined>(undefined);
  const [isFirstVisitWithSummary, setIsFirstVisitWithSummary] = useState(false);
  const [isFeatureEnabled, setIsFeatureEnabled] = useState(false);
  const [scrollSignal, setScrollSignal] = useState(0);
  const capturedRef = useRef(false);
  const preGeneratedRef = useRef(false);
  const [unreadBaseline, setUnreadBaseline] = useState<number | null>(null);

  useEffect(() => {
    if (expanded) setScrollSignal(s => s + 1);
  }, [expanded]);

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

  useEffect(() => {
    if (capturedRef.current || !isMessagesLoaded || !conversationId) return;
    capturedRef.current = true;

    setUnreadBaseline(lastReadAt);

    const cached = readCachedSummary(storageKey);
    if (cached) {
      setContent(cached.content);
      setContentAsOfMessageId(cached.asOfMessageId);
    }

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

  const isContentFresh =
    contentAsOfMessageId !== undefined && contentAsOfMessageId === latestMessageId;

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

  const userSentLatest =
    !!userId &&
    messages !== undefined &&
    messages.length > 0 &&
    messages[messages.length - 1]?.senderId === userId;

  const isAvailable =
    isFeatureEnabled &&
    !userSentLatest &&
    (isFirstVisitWithSummary || (isThreadParticipant && hasEnoughUnread));

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
