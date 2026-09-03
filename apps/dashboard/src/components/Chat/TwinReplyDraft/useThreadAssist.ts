import { useCallback, useEffect, useRef, useState } from 'react';
import { useThreadCatchupSummary } from '../ThreadCatchupSummary/useThreadCatchupSummary';
import type { ThreadCatchupMessages } from '../ThreadCatchupSummary/ThreadCatchupSummary.utils';
import { useTwinReplyDraft } from '../../../hooks/useTwinReplyDraft';
import type { TwinReplyDraftView, PostedTarget } from './twinReplyDraftApi';

export type AssistTab = 'recap' | 'reply';

export interface ThreadAssistState {
  available: boolean;
  collapsed: boolean;
  toggleCollapse: () => void;
  tab: AssistTab;
  setTab: (t: AssistTab) => void;
  hasRecap: boolean;
  hasReply: boolean;
  loading: boolean;
  recap: { content: string | undefined; loading: boolean };
  reply: {
    drafts: TwinReplyDraftView[];
    pending: ReadonlySet<string>;
    approve: (draftId: string, edited?: string) => Promise<PostedTarget | null>;
    decline: (draftId: string) => Promise<void>;
  };
}

export function useThreadAssist(
  conversationId: string | undefined,
  userId: string | undefined,
  messages: ThreadCatchupMessages | undefined,
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

  const prevConv = useRef(conversationId);
  if (prevConv.current !== conversationId) {
    prevConv.current = conversationId;
    setCollapsed(true);
    setTab('reply');
  }

  const hasRecap = recap.isAvailable;
  const hasReply = reply.hasDraft;

  // Both edges below only pick the tab you'd land on — neither expands the tray.
  // It stays collapsed until you open it: the collapsed bar already announces
  // "N AI replies ready", and auto-expanding shoved the composer down the moment
  // a draft landed, under whatever you were mid-way through reading.

  const replyEdge = useRef(false);
  useEffect(() => {
    if (hasReply && !replyEdge.current) {
      replyEdge.current = true;
      setTab('reply');
    } else if (!hasReply) {
      replyEdge.current = false;
    }
  }, [hasReply]);

  const recapEdge = useRef(false);
  useEffect(() => {
    if (recap.isRecommended && !recapEdge.current) {
      recapEdge.current = true;
      setTab(hasReply ? 'reply' : 'recap');
    } else if (!recap.isRecommended) {
      recapEdge.current = false;
    }
  }, [recap.isRecommended, hasReply]);

  const effectiveTab: AssistTab =
    tab === 'reply' && !hasReply ? 'recap' : tab === 'recap' && !hasRecap ? 'reply' : tab;

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
