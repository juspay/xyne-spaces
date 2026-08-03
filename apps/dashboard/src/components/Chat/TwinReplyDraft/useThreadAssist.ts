import { useCallback, useEffect, useRef, useState } from 'react';
import { useThreadCatchupSummary } from '../ThreadCatchupSummary/useThreadCatchupSummary';
import type { ThreadCatchupMessages } from '../ThreadCatchupSummary/ThreadCatchupSummary.utils';
import { useTwinReplyDraft } from '../../../hooks/useTwinReplyDraft';
import type { TwinReplyDraftView, PostedTarget } from './twinReplyDraftApi';

export type AssistTab = 'recap' | 'reply';

export interface ThreadAssistState {
  /** Whether the dock should render at all (recap enabled OR a draft exists). */
  available: boolean;
  /** Collapsed = the minimal one-line bar above the composer; expanded = full. */
  collapsed: boolean;
  toggleCollapse: () => void;
  tab: AssistTab;
  setTab: (t: AssistTab) => void;
  hasRecap: boolean;
  hasReply: boolean;
  loading: boolean;
  recap: { content: string | undefined; loading: boolean };
  reply: {
    /** This thread's pending Twin proposals, newest-first (may be several). */
    drafts: TwinReplyDraftView[];
    /** Draft ids with an approve/decline in flight (per-card spinners). */
    pending: ReadonlySet<string>;
    approve: (draftId: string, edited?: string) => Promise<PostedTarget | null>;
    decline: (draftId: string) => Promise<void>;
  };
}

/**
 * Composes the thread catch-up summary (recap) and the Twin reply draft into ONE
 * dock that lives ATTACHED to the message composer (not in the message list).
 * Reuses both underlying hooks intact; adds only collapse/tab coordination:
 *  - a reply draft (or a recommended recap) auto-expands the dock so the user
 *    sees it the moment they open the thread they were tagged in;
 *  - a recap that's merely enabled (not recommended) starts collapsed as a quiet
 *    one-line bar the user can expand;
 *  - the recap hook fetches on its own `expanded`, so we drive that to follow
 *    "recap tab visible" (edge-triggered, so we never fight its own auto-open).
 */
export function useThreadAssist(
  conversationId: string | undefined,
  userId: string | undefined,
  messages: ThreadCatchupMessages | undefined,
  /** The user's lastReadAt for this thread (epoch ms; 0 if never read) — gates the
   *  recap on unread-from-others rather than total thread length. */
  lastReadAt: number,
  isMessagesLoaded: boolean,
  isThreadParticipant: boolean,
): ThreadAssistState {
  const recap = useThreadCatchupSummary(
    conversationId,
    userId,
    messages,
    lastReadAt,
    isMessagesLoaded,
    isThreadParticipant,
  );
  const reply = useTwinReplyDraft(conversationId);

  const [collapsed, setCollapsed] = useState(true);
  const [tab, setTab] = useState<AssistTab>('reply');

  // Reset coordination state on conversation change (both hooks reset themselves).
  const prevConv = useRef(conversationId);
  if (prevConv.current !== conversationId) {
    prevConv.current = conversationId;
    setCollapsed(true);
    setTab('reply');
  }

  const hasRecap = recap.isAvailable;
  const hasReply = reply.hasDraft;

  // Rising-edge: a reply draft appears → expand on the Reply tab.
  const replyEdge = useRef(false);
  useEffect(() => {
    if (hasReply && !replyEdge.current) {
      replyEdge.current = true;
      setCollapsed(false);
      setTab('reply');
    } else if (!hasReply) {
      replyEdge.current = false;
    }
  }, [hasReply]);

  // Rising-edge: recap recommended → expand (Reply keeps priority if a draft waits).
  const recapEdge = useRef(false);
  useEffect(() => {
    if (recap.isRecommended && !recapEdge.current) {
      recapEdge.current = true;
      setCollapsed(false);
      setTab(hasReply ? 'reply' : 'recap');
    } else if (!recap.isRecommended) {
      recapEdge.current = false;
    }
  }, [recap.isRecommended, hasReply]);

  // If the active tab's content is gone, fall back to what's available.
  const effectiveTab: AssistTab =
    tab === 'reply' && !hasReply ? 'recap' : tab === 'recap' && !hasRecap ? 'reply' : tab;

  // Drive the recap hook's `expanded` to trigger its fetch. We PRE-GENERATE: as
  // soon as the dock is open (regardless of which tab is active), so switching to
  // the Recap tab shows a ready summary instead of a "Generating…" spinner. The
  // recap fetches once per open and the server-side cache dedupes, so this is
  // cheap. Edge-triggered on the derived boolean ONLY, so the recap hook's own
  // auto-open is never fought back closed.
  const recapVisible = hasRecap && !collapsed;
  const lastRecapVisible = useRef(recapVisible);
  useEffect(() => {
    if (lastRecapVisible.current === recapVisible) return;
    lastRecapVisible.current = recapVisible;
    if (recapVisible && !recap.expanded) recap.toggleExpanded();
    else if (!recapVisible && recap.expanded) recap.toggleExpanded();
  }, [recapVisible, recap.expanded, recap.toggleExpanded]);

  const toggleCollapse = useCallback(() => setCollapsed(c => !c), []);

  return {
    available: hasRecap || hasReply,
    collapsed,
    toggleCollapse,
    tab: effectiveTab,
    setTab,
    hasRecap,
    hasReply,
    loading: recap.loading,
    recap: { content: recap.content, loading: recap.loading },
    reply: {
      drafts: reply.drafts,
      pending: reply.pending,
      approve: reply.approve,
      decline: reply.decline,
    },
  };
}
