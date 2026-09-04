import { ReactElement, useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { activitySkipMarkAsReadThreadRef } from '../Activity/activitySkipMarkAsRead';
import {
  useParams,
  useNavigate,
  useLocation,
  useSearchParams,
  useOutletContext,
} from 'react-router-dom';
import { Button } from '../ui/Button';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useChannel, useChannelParticipation } from '../../hooks/useChannels';
import { useRouteContext } from '../../hooks/useRouteContext';
import { usePlatform } from '../../hooks/usePlatform';
import { useIsInPanelWebview } from '../../hooks/useIsInPanelWebview';
import { X, FileText, ClipboardCheck, Hash, Tag as TagIcon, ChevronRight } from 'lucide-react';
import {
  ArrowLeft,
  ArrowTurnDownRight,
  MaximizeTwoArrow,
  LinkHorizontal,
  ExternalLinkSquare,
  LinkSlant,
  MultipleCrossCancelDefault,
  ChatDefault,
  TicketToken,
  FolderDefault,
  ClipboardCheck as ClipboardCheckIcon,
  ThreeDotsMenuVertical,
} from '@xyne/icons';
import { useChannelDisplayName } from '../../hooks/useChannelDisplayName';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '../ui/dropdown-menu';
import { ChatInput } from './ChatInput';
import ThreadList from './ThreadList/ThreadList';
import { useDragAndDropAreaRef } from '../../hooks/useDragAndDropAreaRef';
import { DragAndDropOverlay } from './DragAndDropOverlay';
import { ConversationSubscription } from './ConversationSubscription';
import { useChannelSubscription } from '../../hooks/useChannelSubscription';
import { insertDateSeparatorsForThreadMessages } from '../../utils/chatUtils';
import { htmlToPlainText } from '../../utils/sanitizer';
import { QueryResultType } from '@rocicorp/zero';
import * as Tabs from '@radix-ui/react-tabs';
import { cn } from '../../utils/classNames';
import JoinChannel from './JoinChannel/JoinChannel';
import { BotBubble } from './BotBubble';
import { ThreadTags, parseThreadTypes, useSetThreadTypes } from '../tags/ThreadTags';
import { ThreadTagMenuItems } from '../tags/ThreadTagMenuItems';
import { useShowThreadTags } from '../../hooks/useShowThreadTags';
import { toast } from 'sonner';
import { TicketDetails } from '../Tickets/TicketDetails/TicketDetails';
import { FileBubble } from '../ui/FileBubble/FileBubble';
import { MessageType, ChannelScopeType, BaseTicketType, parseTicketMd } from '@xyne/shared';
import { RCAPanelView } from '../Tickets/RCAPanelView';
import Tooltip from '../ui/Tooltip';
import { ShortcutTooltip } from '../ui/ShortcutTooltip';
import { useScope } from '../../shortcuts';
import { useShareableOrigin } from '../../hooks/useShareableOrigin';
import GlobalCommandMenu from '../GlobalCommandMenu/GlobalCommandMenu';
import type { ContextItem } from './ThreadContextPanel/ThreadContextPanel.types';
import {
  isElectronApp,
  isStandaloneWindow,
  standaloneNavigate,
  APP_DRAG_STYLE,
  APP_NO_DRAG_STYLE,
} from '../../utils/electronApp';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { useZero } from '../../hooks/useZero';
import { logger, Event } from '../../utils/logger';
import { XyneAIStar } from '../icons/xyne-ai';
import { dataLoadDuration, safeRecordMetric } from '../../services/otel';
import { ThreadAssistDock, type TwinSourceInfo } from './TwinReplyDraft/ThreadAssistDock';
import { useThreadAssist } from './TwinReplyDraft/useThreadAssist';
import type {
  PostedTarget,
  TwinReplyDraftView,
  TwinEditSession,
} from './TwinReplyDraft/twinReplyDraftApi';
import { getDraft } from '../../hooks/useDraft';
import { v4 as uuidv4 } from 'uuid';
import { xyneAIActor, type ThreadInfo } from '../../machines/xyneAIMachine';
import { setThreadLastRead } from '../../machines/stateMachine';
import { useSelf, useUser } from '../../hooks/useUsers';
import { CallParticipantsSelectionModal } from '../Call/CallParticipantsSelectionModal';
import { ScheduleCallModal } from '../Call/ScheduleCallModal/ScheduleCallModal';
import { ThreadCallButton } from '../Call/ThreadCallButton/ThreadCallButton';
import { ThreadRecordingButton } from '../Call/ThreadRecordingButton/ThreadRecordingButton';
import { sendRecordingEvent, useRecordingStore } from '../../hooks/useRecordingStore';
import { getRecordingDefaultLayout } from '../../hooks/useRecordingDefaultLayout';
import { ConversationTabContext } from './ConversationTabContext';

type TabType = 'thread' | 'details' | 'files' | 'rca';
type UnderTicketTabType = 'replies' | 'rca';

interface ThreadMessagesProps {
  channelId?: string;
  conversationId?: string;
  ticketId?: string | null;
  onClose?: () => void;
  showHeader?: boolean;
  underTicketView?: boolean;
  simpleView?: boolean;
  hideHeader?: boolean;
  onSummaryClick?: () => void;
  threadMessages?: QueryResultType<typeof queries.conversationMessagesV2>;
  disableAskAI?: boolean;
  previewCardMode?: boolean;
  conversationParticipant?: { lastReadAt?: number | null };
  hideTabBar?: boolean;
  /** Scroll to and highlight this specific message on mount. Used by search screen sidebar to bypass URL-hash navigation. */
  matchedMessageId?: string | null;
  /** Show a clickable channel name badge next to the heading. Used by the search results sidebar. */
  showChannelLink?: boolean;
  /** Custom click handler for the channel name badge. Defaults to opening the thread in-channel. */
  onChannelLinkClick?: () => void;
  skipInputAutoFocus?: boolean;
  /** Overrides what the header's Ask AI button does. Defaults to opening the
   *  panel on this thread; hosts with their own agent session (e.g. Desk's
   *  draft agent) pass their own opener. */
  onAskAI?: (threadInfo?: ThreadInfo) => void;
  /** Overrides the bubbles' default profile navigation (pass a noop to disable it, e.g. SDLC panels). */
  onUserClick?: ((userId: string) => void) | undefined;
  headerActionsContainer?: HTMLElement | null;
}

export const ThreadMessages = ({
  channelId: propChannelId,
  conversationId: propConversationId,
  ticketId: propTicketId,
  onClose,
  showHeader = false,
  underTicketView = false,
  simpleView = false,
  hideHeader = false,
  threadMessages: propThreadMessages,
  disableAskAI,
  previewCardMode = false,
  conversationParticipant: propConversationParticipant,
  hideTabBar = false,
  matchedMessageId,
  showChannelLink = false,
  onChannelLinkClick,
  skipInputAutoFocus: propSkipInputAutoFocus = false,
  onAskAI,
  onUserClick,
  headerActionsContainer,
}: ThreadMessagesProps = {}): ReactElement => {
  const {
    channelId: paramChannelId,
    conversationId: paramConversationId,
    ticketId: paramTicketId,
  } = useParams<{
    channelId?: string;
    conversationId?: string;
    ticketId?: string;
  }>();

  const { isMobile } = usePlatform();
  const isInPanelWebview = useIsInPanelWebview();
  const { baseRoute, buildChannelRoute } = useRouteContext();

  const currentUser = useSelf();
  const shareableOrigin = useShareableOrigin();

  const outletContext = useOutletContext<{ onClose?: () => void } | null>();
  const resolvedOnClose = onClose ?? outletContext?.onClose;

  // Restore Electron window dragging on the thread header — but ONLY when this is the
  // real thread panel (route-mounted or ChatView split view). Those sites pass no
  // `onClose` prop (they derive it from the outlet context), whereas the search/call
  // sidebars pass an explicit `onClose` and preview cards pass `previewCardMode`; those
  // must never move the OS window. Attachment/citation/ticket modals suppress this
  // header entirely (hideHeader / underTicketView), so they are excluded already.
  const isDraggableThreadPanel = onClose === undefined && !previewCardMode;

  const channelId = propChannelId || paramChannelId;
  const conversationId = propConversationId || paramConversationId;
  const ticketId = propTicketId !== undefined ? propTicketId || undefined : paramTicketId;
  const messageLoadStartTimeRef = useRef<number | null>(null);

  // Track derived values from ticket
  const [derivedConversationId, setDerivedConversationId] = useState(conversationId || '');
  const [derivedChannelId, setDerivedChannelId] = useState(channelId || '');

  const [searchParams] = useSearchParams();
  const selectedTabParam = searchParams.get('selectedTab');
  const validTabs: TabType[] = ['thread', 'details', 'files', 'rca'];
  const selectedTab: TabType = validTabs.includes(selectedTabParam as TabType)
    ? (selectedTabParam as TabType)
    : 'thread';

  const isFocusedThread = searchParams.get('focusThread') === '1';
  const skipInputAutoFocus = propSkipInputAutoFocus || searchParams.get('nofocus') === '1';

  // The initial visible-channel cache excludes closed DMs. Query the specific
  // channel as a fallback so a subscribed thread in a closed DM is not treated
  // as proof that the user is a non-member.
  const participationStatus = useChannelParticipation(derivedChannelId);
  const isMember = !!participationStatus;

  // Single enriched query: replaces getConversationById + ticketById + conversationMessagesV2
  // (4 pipelines → 1 pipeline, 178ms → 44ms hydration)
  const threadConversationQuery = useMemo(
    () =>
      queries.threadConversationV2({
        conversationId: derivedConversationId || ' ',
        // While membership is unresolved, omit isMember instead of passing
        // false. The general ACL can then check channel_participants directly;
        // passing false would reject a private DM before status hydration.
        ...(derivedChannelId
          ? {
              channelId: derivedChannelId,
              ...(isMember ? { isMember: true } : {}),
            }
          : {}),
      }),
    [derivedConversationId, derivedChannelId, isMember],
  );
  const [conversation, conversationDetails] = useCachedQuery(threadConversationQuery, {
    enabled: !!derivedConversationId,
  });

  // Participant comes from the combined threadConversation query or from prop (batch fetch in UserThreads)
  const conversationParticipant = useMemo(() => {
    const source =
      propConversationParticipant !== undefined
        ? propConversationParticipant
        : conversation?.participants;

    if (!source) {
      return { lastReadAt: 0 };
    }

    if (source.lastReadAt === null || source.lastReadAt === undefined) {
      return { ...source, lastReadAt: 0 };
    }

    return source;
  }, [propConversationParticipant, conversation?.participants]);

  const isThreadParticipant = useMemo(() => {
    const source =
      propConversationParticipant !== undefined
        ? propConversationParticipant
        : conversation?.participants;
    return !!source;
  }, [propConversationParticipant, conversation?.participants]);

  const ticket = useMemo(() => parseTicketMd(conversation?.ticket_md), [conversation?.ticket_md]);
  const derivedTicketId = ticketId || conversation?.ticketId || '';
  const [threadTicket] = useCachedQuery(queries.ticketRowById({ ticketId: derivedTicketId }), {
    enabled: !!derivedTicketId,
  });
  const isFlowStep = !!threadTicket?.rootId;

  const [threadSubTicketMappings] = useCachedQuery(
    queries.subTicketsForTicket({ ticketId: derivedTicketId }),
    { enabled: !!derivedTicketId },
  );
  const spawnedTicketMessageIds = useMemo(() => {
    const ids = new Set<string>();
    for (const mapping of threadSubTicketMappings ?? []) {
      const sourceMessageId = mapping.subTicket?.mappedTicket?.messageId;
      if (sourceMessageId) ids.add(sourceMessageId);
    }
    return ids;
  }, [threadSubTicketMappings]);

  // Update derived values when props/params change OR when conversation loads
  useEffect(() => {
    if (conversationId) {
      setDerivedConversationId(conversationId);
    } else if (conversation?.conversationId) {
      setDerivedConversationId(conversation.conversationId);
    }

    if (channelId) {
      setDerivedChannelId(channelId);
    } else if (conversation?.channelId) {
      setDerivedChannelId(conversation.channelId);
    }
  }, [conversationId, channelId, conversation]);

  // Messages come from the enriched conversation query; initialMessage = messages[0]
  // Spread to mutable array since ThreadList expects mutable type
  const queriedMessages = useMemo(
    () => (conversation?.messages ? [...conversation.messages] : undefined),
    [conversation?.messages],
  );
  const queryDetails = conversationDetails;

  // Use pre-fetched messages if provided, otherwise use queried
  const messages = useMemo(
    () => propThreadMessages ?? queriedMessages ?? [],
    [propThreadMessages, queriedMessages],
  );
  const messagesDetails = propThreadMessages ? { type: 'complete' as const } : queryDetails;
  const isMessagesLoaded = messagesDetails.type === 'complete' || messagesDetails.type === 'error';

  // The enriched thread query is re-subscribed whenever its inputs change — most
  // notably when channel membership (isMember) resolves and recreates the query
  // object. During that re-subscription `conversation` reads null for a frame or
  // two while `isMessagesLoaded` stays true. That transient used to flip the render
  // below from <ThreadList> to the "No thread messages" placeholder and back,
  // remounting ThreadList mid-open. The remount re-ran ThreadList's mark-as-read
  // effect, which overwrote the stored lastReadAt with `now`, so the unread divider
  // and first-unread scroll position were lost and the panel fell back to the
  // bottom. Hold the last resolved conversation for the current thread so the
  // placeholder only shows for a genuinely empty/absent thread and ThreadList stays
  // stably mounted across the re-subscription. Reset synchronously when the thread
  // id changes so a switched-to thread never reads the previous one's value.
  const lastResolvedConversationRef = useRef(conversation);
  const lastResolvedConversationIdRef = useRef(derivedConversationId);
  if (lastResolvedConversationIdRef.current !== derivedConversationId) {
    lastResolvedConversationIdRef.current = derivedConversationId;
    lastResolvedConversationRef.current = undefined;
  }
  if (conversation) {
    lastResolvedConversationRef.current = conversation;
  }
  const stableConversation = conversation ?? lastResolvedConversationRef.current;

  const threadParticipantIds = useMemo(() => {
    const set = new Set<string>();
    for (const m of messages) {
      if (m.senderId) set.add(m.senderId);
    }
    return set;
  }, [messages]);
  const assist = useThreadAssist(
    derivedConversationId,
    currentUser?.id,
    messages,
    conversationParticipant.lastReadAt ?? 0,
    isMessagesLoaded,
    isThreadParticipant,
  );
  const [isScheduleCallModalOpen, setIsScheduleCallModalOpen] = useState(false);
  const channel = useChannel(derivedChannelId);
  const { displayName: channelDisplayName } = useChannelDisplayName(channel, currentUser?.id ?? '');
  const isDmThread =
    channel?.scopeType === ChannelScopeType.DM || channel?.scopeType === ChannelScopeType.GROUP_DM;

  // Tab state - default to 'details' when opening from a ticket card
  const [activeTab, setActiveTab] = useState<TabType>(selectedTab);

  // Sync activeTab with URL query param when it changes
  useEffect(() => {
    setActiveTab(selectedTab);
  }, [selectedTab]);

  // Tab state for underTicketView mode
  const [underTicketActiveTab, setUnderTicketActiveTab] = useState<UnderTicketTabType>('replies');

  // Create ticket modal state
  const [isCreateTicketModalOpen, setIsCreateTicketModalOpen] = useState(false);

  // Context selection state
  const [isContextMenuOpen, setIsContextMenuOpen] = useState(false);
  const [contextItems, setContextItems] = useState<ContextItem[]>([]);

  const handleAddContextClick = (): void => {
    logger.info(Event.THREAD_CONTEXT_BUTTON_CLICKED, {
      conversationId: derivedConversationId,
      userId: currentUser?.id,
    });
    setIsContextMenuOpen(true);
  };

  const handleContextItemToggle = (item: ContextItem): void => {
    setContextItems(prev =>
      prev.some(c => c.id === item.id) ? prev.filter(c => c.id !== item.id) : [...prev, item],
    );
  };

  const buildContextMessage = (): string => {
    const typeLabels: Record<string, string> = {
      channel: 'Channels',
      conversation: 'Messages',
      ticket: 'Tickets',
      attachment: 'Attachments',
      user: 'Users',
    };

    const groups = new Map<string, ContextItem[]>();
    for (const item of contextItems) {
      const list = groups.get(item.type) ?? [];
      list.push(item);
      groups.set(item.type, list);
    }

    const parts: string[] = ['<strong>Relevant Contexts:</strong>'];
    for (const [type, items] of groups) {
      const label = typeLabels[type] ?? type;
      const links = items
        .map(
          (item, i) => `&nbsp;&nbsp;&nbsp;&nbsp;${i + 1}. <a href="${item.url}">${item.title}</a>`,
        )
        .join('<br>');
      parts.push(`<strong>${label}:</strong><br>${links}`);
    }

    return parts.join('<br>');
  };
  // Call participants modal state
  const [showParticipantsModal, setShowParticipantsModal] = useState(false);

  // Global recording status — used to guard the thread "Take notes" button
  // against starting a second recording while one is already in progress.
  const recordingStatus = useRecordingStore(ctx => ctx.status);

  // Navigation for thread summary
  const navigate = useNavigate();
  const location = useLocation();

  const handleTwinPosted = useCallback(
    (target: PostedTarget | null) => {
      if (!target?.channelId) return;
      const sameThread =
        target.channelId === derivedChannelId &&
        (target.conversationId ?? '') === (derivedConversationId ?? '');
      if (sameThread) return;
      const path = target.conversationId
        ? `${baseRoute}/${target.channelId}/${target.conversationId}#origin=${target.conversationId}`
        : `${baseRoute}/${target.channelId}`;
      void navigate(path);
    },
    [navigate, baseRoute, derivedChannelId, derivedConversationId],
  );

  const [reasoningDraft, setReasoningDraft] = useState<TwinReplyDraftView | undefined>(undefined);

  const [twinEditDraftId, setTwinEditDraftId] = useState<string | null>(null);
  const editingTwinDraft = useMemo(
    () => assist.reply.drafts.find(d => d.id === twinEditDraftId) ?? null,
    [assist.reply.drafts, twinEditDraftId],
  );
  useEffect(() => {
    if (twinEditDraftId && !editingTwinDraft) setTwinEditDraftId(null);
  }, [twinEditDraftId, editingTwinDraft]);

  const exitTwinEdit = (): void => {
    setTwinEditDraftId(null);
  };

  const twinEditSession: TwinEditSession | undefined = editingTwinDraft
    ? {
        draftId: editingTwinDraft.id,
        message: editingTwinDraft.message ?? '',
        ...(editingTwinDraft.senderName ? { senderName: editingTwinDraft.senderName } : {}),
        onApprove: (editedText: string) => {
          void (async () => {
            try {
              const posted = await assist.reply.approve(
                editingTwinDraft.id,
                editedText || undefined,
              );
              exitTwinEdit();
              handleTwinPosted(posted);
            } catch {
              toast.error('Failed to send reply', {
                description: 'Your edit was kept — please try again.',
              });
            }
          })();
        },
      }
    : undefined;

  const messagesById = useMemo(() => {
    const map = new Map<string, { content?: unknown }>();
    for (const m of messages) map.set(m.messageId, m);
    return map;
  }, [messages]);

  const resolveTwinSource = useCallback(
    (draft: TwinReplyDraftView): TwinSourceInfo => {
      const srcId = draft.sourceMessageId;
      const srcMsg = srcId ? messagesById.get(srcId) : undefined;
      const rawContent = srcMsg && typeof srcMsg.content === 'string' ? srcMsg.content : undefined;
      let text: string | undefined;
      if (rawContent && typeof DOMParser !== 'undefined') {
        try {
          text =
            (
              new DOMParser().parseFromString(rawContent, 'text/html').body.textContent || ''
            ).trim() || undefined;
        } catch {
          text = undefined;
        }
      }
      const onJump =
        srcId && derivedConversationId
          ? () => {
              const el = document.getElementById(
                `thread-message-${derivedConversationId}-${srcId}`,
              );
              if (!el) return;
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.animate(
                [{ backgroundColor: 'rgba(99,102,241,0.14)' }, { backgroundColor: 'transparent' }],
                { duration: 1400, easing: 'ease-out' },
              );
            }
          : undefined;
      return {
        ...(draft.senderId ? { userId: draft.senderId } : {}),
        ...(draft.senderName ? { name: draft.senderName } : {}),
        ...(text ? { text } : {}),
        ...(onJump ? { onJump } : {}),
      };
    },
    [messagesById, derivedConversationId],
  );

  const renderTwinDock = (attached: boolean) =>
    assist.available ? (
      <ThreadAssistDock
        key='twin-dock'
        hasRecap={assist.hasRecap}
        hasReply={assist.hasReply}
        tab={assist.tab}
        onTabChange={assist.setTab}
        collapsed={assist.collapsed}
        onToggleCollapse={assist.toggleCollapse}
        recap={assist.recap}
        reply={assist.reply}
        onPosted={handleTwinPosted}
        onReasoningOpenChange={(d: TwinReplyDraftView, open: boolean) =>
          setReasoningDraft(open ? d : undefined)
        }
        reasoningOpen={!!reasoningDraft}
        conversationId={derivedConversationId ?? ''}
        resolveSource={resolveTwinSource}
        attached={attached}
        {...(attached && { onBeginEdit: (d: TwinReplyDraftView) => setTwinEditDraftId(d.id) })}
        {...(attached && editingTwinDraft && { onEditBack: exitTwinEdit })}
      />
    ) : null;
  const twinDock = renderTwinDock(true);
  const twinDockCard = renderTwinDock(false);

  // Check if the route is /threads (with optional workspace prefix)
  const isThreadsRoute = location.pathname.endsWith('/chat/dir/threads');

  // Check if thread summary is currently active
  const isThreadSummaryActive = location.hash.startsWith('#thread-summary');

  // Drag and drop functionality
  const { dragAndDropAreaRef, inputRef, isDragging } = useDragAndDropAreaRef(derivedConversationId);

  useChannelSubscription(derivedChannelId, derivedConversationId ? [derivedConversationId] : []);
  useScope('thread', Boolean(derivedConversationId && derivedChannelId));

  useEffect(() => {
    // eslint-disable-next-line react-hooks/exhaustive-deps -- skipInputAutoFocus intentionally not in deps; the param can be stripped from the URL without re-firing
    if (previewCardMode || isMobile || skipInputAutoFocus || !derivedConversationId) return;

    const rafId = requestAnimationFrame(() => {
      const activeEl = document.activeElement;
      if (activeEl && activeEl.closest('input, textarea, [contenteditable="true"]')) return;
      inputRef.current?.focus();
    });

    return () => cancelAnimationFrame(rafId);
  }, [derivedConversationId, isMobile, previewCardMode]);

  // Track thread message loading performance
  useEffect(() => {
    if (messagesDetails.type === 'unknown') {
      messageLoadStartTimeRef.current = Date.now();
    } else if (messagesDetails.type === 'complete') {
      if (messageLoadStartTimeRef.current !== null) {
        const duration = Date.now() - messageLoadStartTimeRef.current;
        logger.info(Event.THREAD_MESSAGES_LOADED, {
          source: 'ThreadPannel',
          message: 'Thread messages loaded',
          durationMs: duration,
          url: window.location.href,
        });

        safeRecordMetric(() => {
          dataLoadDuration.record(duration, {
            source: 'ThreadPannel',
            event: Event.THREAD_MESSAGES_LOADED,
            platform: logger.platformName,
          });
        });

        messageLoadStartTimeRef.current = null;
      }
    } else if (messagesDetails.type === 'error') {
      if (messageLoadStartTimeRef.current !== null) {
        const duration = Date.now() - messageLoadStartTimeRef.current;
        logger.info(Event.THREAD_MESSAGES_LOADED, {
          source: 'ThreadPannel',
          message: 'Thread messages load failed',
          durationMs: duration,
          url: window.location.href,
        });

        safeRecordMetric(() => {
          dataLoadDuration.record(duration, {
            source: 'ThreadPannel',
            event: Event.THREAD_MESSAGES_LOADED,
            platform: logger.platformName,
          });
        });

        messageLoadStartTimeRef.current = null;
      }
    } else {
      messageLoadStartTimeRef.current = null;
    }
  }, [messagesDetails.type, derivedConversationId, messages]);

  const isUserMember = isMember;

  const zero = useZero();

  // Own skipMarkAsRead ref for thread — independent of channel's skipMarkAsRead in ConversationPanelV2
  const skipMarkAsReadThreadRef = useRef(false);
  const setSkipMarkAsReadThread = useCallback((skip: boolean) => {
    skipMarkAsReadThreadRef.current = skip;
  }, []);

  const conversationTabContextValue = useMemo(
    () => ({
      setActiveTab: (): void => undefined,
      setSkipMarkAsRead: setSkipMarkAsReadThread,
      skipMarkAsReadRef: skipMarkAsReadThreadRef,
    }),
    [setSkipMarkAsReadThread],
  );

  useEffect(() => {
    return () => {
      if (skipMarkAsReadThreadRef?.current || activitySkipMarkAsReadThreadRef.current) {
        skipMarkAsReadThreadRef.current = false;
        activitySkipMarkAsReadThreadRef.current = false;
        return;
      }
      if (derivedConversationId) {
        const draft = getDraft(derivedChannelId, derivedConversationId);
        void zero.mutate(
          mutators.activities.markThreadActivitiesAsReadV2({
            conversationId: derivedConversationId,
            draftMessage: draft || '',
            draftMessageId: uuidv4(),
            timestamp: Date.now(),
            participantId: uuidv4(),
          }),
        );
      }
    };
  }, [derivedConversationId]);

  // Check if this is a ticket thread
  const isTicketThread = useMemo(() => {
    if (!conversation?.metadata) return false;
    const metadata = conversation.metadata as { ticketId?: string };
    return metadata.ticketId !== undefined;
  }, [conversation]);

  const handleContextConfirm = (): void => {
    if (contextItems.length === 0 || !derivedConversationId) return;
    const content = buildContextMessage();
    logger.info(Event.THREAD_CONTEXT_SUBMITTED, {
      conversationId: derivedConversationId,
      itemCount: contextItems.length,
      types: [...new Set(contextItems.map(i => i.type))],
      userId: currentUser?.id,
    });
    const ts = Date.now();
    void zero.mutate(
      mutators.messages.send({
        conversationId: derivedConversationId,
        content,
        type: MessageType.USER,
        showInChannel: false,
        timestamp: ts,
        messageId: uuidv4(),
      }),
    );
    // Sender has implicitly read up to their own message
    setThreadLastRead(derivedConversationId, ts);
    setContextItems([]);
    setIsContextMenuOpen(false);
  };

  const hasActiveCallForConversation = useMemo(() => {
    return !!conversation?.callId;
  }, [conversation?.callId]);

  // Create thread info for XyneAI context
  const initialMessage = conversation?.messages?.[0] ?? null;
  const initialMessageSender = useUser(initialMessage?.senderId || '');
  const setThreadTypes = useSetThreadTypes(derivedConversationId);
  const { showThreadTags } = useShowThreadTags();
  // Which tag's evidence is on screen. Owned here because this component renders both the
  // chips and the message list; cleared on thread change so it never leaks across threads.
  const [inspectedTag, setInspectedTag] = useState<string | null>(null);
  useEffect(() => setInspectedTag(null), [derivedConversationId]);

  const threadInfo: ThreadInfo | null = useMemo(() => {
    if (!derivedConversationId || !initialMessage) return null;

    const senderName: string = String(initialMessageSender?.name || 'Unknown');
    const contentStr: string =
      typeof initialMessage.content === 'string' ? initialMessage.content : '';
    // Message content is stored as HTML — slicing it raw leaks tags (and can cut
    // mid-tag) into the Ask AI context pill label.
    const previewText: string = htmlToPlainText(contentStr).slice(0, 100);

    return {
      conversationId: derivedConversationId,
      ...(derivedChannelId && { channelId: derivedChannelId }),
      senderName,
      previewText,
      ...(initialMessage.senderId && { senderId: initialMessage.senderId }),
      ...(initialMessage.messageId && { messageId: initialMessage.messageId }),
      // Opened from the thread panel header — the context is the thread itself,
      // so the pill should navigate back into it.
      isThreadMessage: true,
    };
  }, [derivedConversationId, derivedChannelId, initialMessage, initialMessageSender]);

  // Check if any message has a ticketId in metadata
  const hasTicketInMessages = useMemo(() => {
    if (!messages || messages.length === 0) return false;
    return messages.some(msg => {
      const metadata = msg.metadata as { ticketId?: string } | null;
      return metadata?.ticketId !== undefined;
    });
  }, [messages]);

  // Prepare messages with date separators for ticket threads
  const messagesWithSeparators = useMemo(() => {
    if (isTicketThread || ticketId) {
      return insertDateSeparatorsForThreadMessages(messages);
    }
    return undefined;
  }, [messages, isTicketThread, ticketId]);

  // Fetch ticket attachments if this is a ticket thread
  // Memoized query request — same per-render AST/hash churn as threadConversationQuery.
  const ticketAttachmentsQuery = useMemo(
    () => queries.attachmentsByTicket({ ticketId: derivedTicketId }),
    [derivedTicketId],
  );
  const [ticketAttachments] = useCachedQuery(ticketAttachmentsQuery, {
    enabled: !!derivedTicketId,
  });

  // Get all attachments with their parent messages
  // For tickets, use ticket attachments. For regular conversations, use message attachments
  const files = useMemo(() => {
    // If this is a ticket, use ticket attachments
    if (derivedTicketId && ticketAttachments) {
      return ticketAttachments.map(att => ({
        attachment: att,
        message: null, // Ticket attachments don't have an associated message
      }));
    }

    // Otherwise, use message attachments (for regular conversations)
    if (!messages) return [];
    return messages
      .flatMap(msg => {
        if (!msg.hasAttachment || !msg.attachments || msg.attachments.length === 0) {
          return [];
        }
        return msg.attachments.map(att => ({
          message: msg,
          attachment: att,
        }));
      })
      .filter(item => !!item.attachment);
  }, [messages, derivedTicketId, ticketAttachments]);

  const fileAttachments = useMemo(() => files.map(f => f.attachment), [files]);

  // Build tabs array - exclude Details tab when ticketId is present
  const isFixTicket = ticket?.ticketType === BaseTicketType.Fix;

  // Support URL-driven tab selection for the compact side panel mode as well.
  useEffect(() => {
    if (!underTicketView) return;
    if (hideTabBar) {
      setUnderTicketActiveTab('replies');
      return;
    }

    if (selectedTab === 'rca' && isFixTicket) {
      setUnderTicketActiveTab('rca');
      return;
    }
    setUnderTicketActiveTab('replies');
  }, [underTicketView, selectedTab, isFixTicket, hideTabBar]);

  const tabs = useMemo(() => {
    const allTabs = [
      { value: 'thread' as const, label: 'Messages', icon: <ChatDefault size={14} /> },
      { value: 'details' as const, label: 'Details', icon: <TicketToken size={14} /> },
      {
        value: 'files' as const,
        label: 'Files',
        count: files.length,
        icon: <FolderDefault size={14} />,
      },
      ...(isFixTicket
        ? [{ value: 'rca' as const, label: 'RCA', icon: <ClipboardCheckIcon size={14} /> }]
        : []),
    ];

    // Filter out Details tab when ticketId doesn't exist
    return !derivedTicketId ? allTabs.filter(tab => tab.value !== 'details') : allTabs;
  }, [files.length, ticketId, derivedTicketId, isFixTicket]);

  const handleCreateTicket = (): void => {
    setIsCreateTicketModalOpen(true);
  };

  const handleInitiateCall = (): void => {
    setShowParticipantsModal(true);
  };

  // Starts a headless (note-taker) recording anchored to this thread: posts
  // one anchor message into the thread now and connects the mic in the
  // background via the recording store directly (no navigation) — the user
  // stays in the thread and can open /recordings/:callId later from the
  // message that appears, or from the sidebar, whenever they want.
  const handleStartRecordingFromThread = (): void => {
    if (!derivedConversationId || !derivedChannelId) return;
    if (recordingStatus !== 'idle' && recordingStatus !== 'error') {
      toast.info('A recording is already in progress');
      return;
    }
    sendRecordingEvent({ type: 'clearTranscripts' });
    sendRecordingEvent({
      type: 'startRecording',
      defaultLayout: getRecordingDefaultLayout(),
      conversationId: derivedConversationId,
      channelId: derivedChannelId,
    });
    toast.success('Recording started', {
      description: 'Taking notes in the background \u2014 open Recordings anytime to view it live.',
    });
  };

  const handleTicketCreated = (): void => {
    toast.success('Success', {
      description: 'Ticket created successfully',
      duration: 3000,
    });
  };

  const handleCloseTicketDetailsThread = (): void => {
    if (isStandaloneWindow()) {
      window.close();
      return;
    }

    const navState = location.state as {
      fromMyTickets?: boolean;
      fromActivity?: boolean;
      fromTable?: boolean;
      returnToUrl?: string;
      activeTab?: string;
    } | null;

    // Check if user came from activity, tickets table, tickets tab, or has a return URL
    const fromActivity = navState?.fromActivity || location.pathname.startsWith('/chat/activity/');
    const fromTable = navState?.fromTable;
    const isFromTickets =
      location.search.includes('tab=tickets') && location.search.includes('ticketId');
    const returnToUrl = navState?.returnToUrl;

    if (isMobile) {
      if (returnToUrl) {
        // Use the return URL if provided
        void navigate(returnToUrl, { replace: true });
      } else if (fromActivity) {
        // Navigate back to activity tab
        void navigate('/chat/activity', { replace: true });
      } else if (fromTable || isFromTickets) {
        // Navigate to tickets tab if coming from tickets/table
        void navigate(buildChannelRoute(derivedChannelId, { tab: 'tickets' }), {
          replace: true,
        });
      } else {
        // Navigate to channel (messages tab)
        void navigate(`${baseRoute}/${derivedChannelId}`, { replace: true });
      }
    } else {
      // Navigate to channel (messages tab)
      void navigate(`${baseRoute}/${derivedChannelId}`, { replace: isMobile });
    }
  };

  // From a focused thread, load the full channel (with this thread still open).
  // Drops focusThread but preserves the origin/messageId hash so the channel list
  // anchors to the right message.
  const handleOpenInChannel = (): void => {
    const params = new URLSearchParams(location.search);
    params.delete('focusThread');
    const qs = params.toString();
    void navigate(
      `${baseRoute}/${derivedChannelId}/${derivedConversationId}${qs ? `?${qs}` : ''}${location.hash}`,
    );
  };

  // Icon actions sit muted at rest and come up to full strength on hover —
  // matches ConversationHeader's action row.
  const actionIconClass = 'text-muted-foreground hover:text-foreground';

  const showBreadcrumb = (isFocusedThread || showChannelLink) && !isStandaloneWindow() && !!channel;
  const focusedChannelBreadcrumb = showBreadcrumb ? (
    <Tooltip content={`Open ${isDmThread ? '' : '#'}${channelDisplayName}`}>
      <button
        type='button'
        onClick={onChannelLinkClick ?? handleOpenInChannel}
        aria-label={`Open ${channelDisplayName}`}
        data-track-category='THREAD_PANEL'
        data-track-name='OPEN_IN_CHANNEL_FROM_FOCUS'
        className='group/chan flex shrink-0 items-center gap-1 max-w-[180px] rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        style={APP_NO_DRAG_STYLE}
      >
        {!isDmThread && (
          <Hash className='size-3.5 shrink-0 opacity-60 transition-opacity group-hover/chan:opacity-100' />
        )}
        <span className='truncate text-sm font-medium group-hover/chan:underline'>
          {channelDisplayName}
        </span>
      </button>
    </Tooltip>
  ) : null;

  const openTicketDetailsExpandedView = (): void => {
    if (!ticket?.channelId || !ticket.conversationId) return;

    standaloneNavigate(
      navigate,
      buildChannelRoute(ticket.channelId, {
        tab: 'tickets',
        ticketId: ticket.id,
        conversationId: ticket.conversationId,
      }),
      { state: { activeTab } },
    );
  };
  const openInNewWindow = (): void => {
    const newWindow = window.open(
      `/newWindow/chat/dir/${derivedChannelId}/${derivedConversationId}`,
      '_blank',
    );
    if (!newWindow) {
      logger.warn(Event.FRONTEND_ERROR, {
        type: 'migrated_console_warn',
        message: String('Failed to open new window - popup may be blocked'),
      });
    } else {
      newWindow.focus();
    }
  };

  const handleCopyTicketId = () => {
    if (!ticket?.xyneId) return;
    void navigator.clipboard.writeText(ticket.xyneId);
    toast.success('Copied', {
      description: 'Ticket ID copied to clipboard',
      duration: 2000,
    });
  };

  const handleCopyTicketViewLink = () => {
    if (!ticket?.channelId || !ticket.conversationId) return;

    // Use shareable origin from environment variable
    const minimizedTicketViewRoute = `${shareableOrigin}/chat/dir/${ticket.channelId}/${ticket.conversationId}/${ticket.id}?selectedTab=details`;
    void navigator.clipboard.writeText(minimizedTicketViewRoute);
    toast.success('Link copied', {
      description: 'Ticket link copied to clipboard',
      duration: 3000,
    });
  };

  // Early return for underTicketView mode - separate tab-based UI with Messages and RCA
  if (underTicketView) {
    return (
      <div
        className={`flex-1 h-full flex flex-col bg-background overflow-hidden relative ${
          isInPanelWebview ? '' : 'rounded-lg'
        }`}
        ref={dragAndDropAreaRef}
      >
        {/* Drag and Drop Overlay */}
        <DragAndDropOverlay isVisible={isDragging} />
        <Tabs.Root
          value={underTicketActiveTab}
          onValueChange={value => setUnderTicketActiveTab(value as UnderTicketTabType)}
          className='flex-1 flex flex-col h-full overflow-hidden'
        >
          {/* Tab Header */}
          {!hideTabBar && (
            <div className='w-full pl-2 pr-3 py-3 bg-background'>
              <div>
                <Tabs.List className='flex items-center justify-between'>
                  <div className='flex items-center gap-0.5 px-0.5'>
                    {/* Replies Tab */}
                    <Tabs.Trigger asChild value='replies'>
                      <button
                        className={cn(
                          'flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors duration-100 cursor-pointer',
                          underTicketActiveTab === 'replies'
                            ? 'bg-muted text-foreground'
                            : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                        )}
                      >
                        <span className='shrink-0'>
                          <ChatDefault size={14} />
                        </span>
                        <span className='text-sm font-medium tracking-[-0.28px]'>Messages</span>
                      </button>
                    </Tabs.Trigger>

                    {/* RCA Tab */}
                    {isFixTicket && (
                      <Tabs.Trigger asChild value='rca'>
                        <button
                          className={cn(
                            'flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors duration-100 cursor-pointer',
                            underTicketActiveTab === 'rca'
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                          )}
                        >
                          <span className='shrink-0'>
                            <ClipboardCheckIcon size={14} />
                          </span>
                          <span className='text-sm font-medium tracking-[-0.28px]'>RCA</span>
                        </button>
                      </Tabs.Trigger>
                    )}
                  </div>
                  <div className='flex items-center gap-2'>
                    {/* Subscription Button */}
                    {derivedConversationId && (
                      <Tooltip content='Toggle notification subscription'>
                        <div className='p-2 border border-border rounded-lg h-8 w-8'>
                          <ConversationSubscription
                            conversationId={derivedConversationId}
                            {...(conversation && { conversation })}
                            variant='icon-only'
                            className='flex items-center justify-center'
                          />
                        </div>
                      </Tooltip>
                    )}
                    {/* Initiate Call Button */}
                    {derivedConversationId && (
                      <ThreadCallButton
                        onStartCall={handleInitiateCall}
                        onScheduleCall={() => setIsScheduleCallModalOpen(true)}
                        hasActiveCall={hasActiveCallForConversation}
                        trackCategory='THREAD_PANEL'
                        trackName='INITIATE_CALL_FROM_THREAD'
                        trackMetadata={{
                          channelId: channel?.id,
                          conversationId: derivedConversationId,
                        }}
                      />
                    )}
                    {/* Start Recording (Take Notes) Button */}
                    {derivedConversationId && (
                      <ThreadRecordingButton
                        onStartRecording={handleStartRecordingFromThread}
                        hasActiveRecording={
                          recordingStatus !== 'idle' && recordingStatus !== 'error'
                        }
                        trackCategory='THREAD_PANEL'
                        trackName='START_RECORDING_FROM_THREAD'
                        trackMetadata={{
                          channelId: channel?.id,
                          conversationId: derivedConversationId,
                        }}
                      />
                    )}
                  </div>
                </Tabs.List>
              </div>
            </div>
          )}

          {/* Replies Tab Content */}
          <Tabs.Content
            value='replies'
            className='flex-1 flex flex-col overflow-hidden data-[state=inactive]:hidden'
          >
            <ThreadList
              inspectedTag={inspectedTag}
              channelId={derivedChannelId || ''}
              conversationId={derivedConversationId || ''}
              threadMessages={messages}
              {...(onUserClick && { onUserClick })}
              initialScrollOffset={0}
              isTicketThread={false}
              channelScopeType={channel?.scopeType}
              conversation={conversation}
              enableCollapsing={previewCardMode}
              enableJumpFab={!previewCardMode}
              isMessagesLoaded={isMessagesLoaded}
              {...(disableAskAI !== undefined && { disableAskAI })}
              conversationParticipant={conversationParticipant}
            />

            {/* ChatInput at the bottom - only show if user is a member */}
            {isUserMember || channel?.isArchived ? (
              <div className='pb-3 bg-background shrink-0 px-[var(--composer-px)] [--composer-px:0.75rem]'>
                <ChatInput
                  ref={inputRef}
                  channelId={derivedChannelId}
                  conversation={conversation ?? undefined}
                  placeholder='Reply to this thread...'
                  hasTicket={hasTicketInMessages}
                  threadParticipantIds={threadParticipantIds}
                  dockSlot={twinDock}
                  twinEdit={twinEditSession}
                />
              </div>
            ) : previewCardMode && assist.hasReply ? (
              <div className='px-4 pb-4 bg-background'>{twinDockCard}</div>
            ) : (
              <JoinChannel
                channelId={derivedChannelId}
                {...(channel?.name && { channelTitle: channel.name })}
              />
            )}
          </Tabs.Content>

          {/* RCA Tab Content */}
          {isFixTicket && (
            <Tabs.Content
              value='rca'
              className='flex-1 overflow-hidden bg-background data-[state=inactive]:hidden'
            >
              {derivedTicketId ? (
                <RCAPanelView ticketId={derivedTicketId} />
              ) : (
                <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                  <ClipboardCheck size={48} className='mb-2 text-muted-foreground' />
                  <p>Ticket ID not found</p>
                </div>
              )}
            </Tabs.Content>
          )}
        </Tabs.Root>
        {/* Call Participants Selection Modal */}
        {derivedConversationId && (
          <CallParticipantsSelectionModal
            isOpen={showParticipantsModal}
            onClose={() => setShowParticipantsModal(false)}
            channelId={derivedChannelId}
            conversationId={derivedConversationId}
          />
        )}
      </div>
    );
  }

  const simpleViewHeaderActions = (
    <div className='flex items-center gap-1 shrink-0' style={APP_NO_DRAG_STYLE}>
      {/* Ask AI */}
      {!isStandaloneWindow() && (
        <Tooltip content='Ask AI Conversation'>
          <Button
            size='sm'
            variant='ghost'
            onClick={() => {
              if (onAskAI) {
                onAskAI(threadInfo ?? undefined);
                return;
              }
              xyneAIActor.send({
                type: 'OPEN',
                channelId: derivedChannelId,
                threadInfo,
              });
            }}
            data-track-category='THREAD_PANEL'
            data-track-name='OPEN_XYNE_AI_FROM_THREAD'
            className='h-7 w-7 rounded-lg'
          >
            <XyneAIStar />
          </Button>
        </Tooltip>
      )}

      {/* Initiate Call Button */}
      {derivedConversationId && !channel?.isArchived && (
        <ThreadCallButton
          onStartCall={handleInitiateCall}
          onScheduleCall={() => setIsScheduleCallModalOpen(true)}
          hasActiveCall={hasActiveCallForConversation}
          trackCategory='THREAD_PANEL'
          trackName='INITIATE_CALL_FROM_THREAD'
          trackMetadata={{
            channelId: channel?.id,
            conversationId: derivedConversationId,
          }}
        />
      )}

      {/* Start Recording (Take Notes) Button */}
      {derivedConversationId && !channel?.isArchived && (
        <ThreadRecordingButton
          onStartRecording={handleStartRecordingFromThread}
          hasActiveRecording={recordingStatus !== 'idle' && recordingStatus !== 'error'}
          trackCategory='THREAD_PANEL'
          trackName='START_RECORDING_FROM_THREAD'
          trackMetadata={{
            channelId: channel?.id,
            conversationId: derivedConversationId,
          }}
        />
      )}

      {/* Overflow menu */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            className={cn(
              'flex items-center justify-center rounded-lg size-7 hover:bg-accent transition-colors shrink-0',
              actionIconClass,
            )}
            title='More'
            data-testid='thread-more-options-button'
          >
            <ThreeDotsMenuVertical size={16} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='end'
          onCloseAutoFocus={e => e.preventDefault()}
          className='min-w-[180px]'
        >
          {derivedConversationId && (
            <DropdownMenuItem className='p-0' onSelect={e => e.preventDefault()}>
              <ConversationSubscription
                conversationId={derivedConversationId}
                {...(conversation && { conversation })}
                variant='dropdown'
                menuOpen
                className='px-2 py-1.5'
              />
            </DropdownMenuItem>
          )}
          {showThreadTags && !channel?.isArchived && (
            <DropdownMenuSub>
              <DropdownMenuSubTrigger
                className='gap-2'
                data-track-category='THREAD_PANEL'
                data-track-name='OPEN_THREAD_TAG_MENU'
              >
                <TagIcon size={16} className='shrink-0' />
                <span className='flex-1'>Thread tags</span>
                <ChevronRight size={16} className='shrink-0 text-muted-foreground' />
              </DropdownMenuSubTrigger>
              <DropdownMenuSubContent className='min-w-[220px]'>
                <ThreadTagMenuItems
                  applied={parseThreadTypes(conversation?.threadType)}
                  onToggle={name => {
                    const applied = parseThreadTypes(conversation?.threadType);
                    void setThreadTypes(
                      applied.includes(name)
                        ? applied.filter(value => value !== name)
                        : [...applied, name],
                    );
                  }}
                />
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          )}
          {!isMobile && !channel?.isArchived && (
            <DropdownMenuItem
              className='gap-2'
              onClick={handleAddContextClick}
              data-track-category='THREAD_PANEL'
              data-track-name='OPEN_CONTEXT_MENU'
              data-track-metadata={JSON.stringify({
                conversationId: derivedConversationId,
              })}
            >
              <LinkHorizontal size={16} className='shrink-0' />
              <span className='flex-1'>Add context to thread</span>
            </DropdownMenuItem>
          )}
          {isElectronApp() && !isStandaloneWindow() && (
            <DropdownMenuItem
              className='gap-2'
              onClick={openInNewWindow}
              data-track-category='THREAD_PANEL'
              data-track-name='OPEN_THREAD_IN_NEW_WINDOW'
            >
              <ExternalLinkSquare size={16} className='shrink-0' />
              <span className='flex-1'>Open in new window</span>
            </DropdownMenuItem>
          )}
          {channel?.projectId && !hasTicketInMessages && !channel?.isArchived && (
            <DropdownMenuItem
              className='gap-2'
              onClick={handleCreateTicket}
              data-testid='thread-create-ticket-button'
              data-track-category='THREAD_PANEL'
              data-track-name='CREATE_TICKET_FROM_THREAD'
              data-track-metadata={JSON.stringify({
                channelId: channel?.id,
                projectId: channel?.projectId,
              })}
            >
              <TicketToken size={16} className='shrink-0' />
              <span className='flex-1'>Create ticket</span>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Close Button */}
      {(!simpleView || resolvedOnClose) && !headerActionsContainer && (
        <ShortcutTooltip label='Close' shortcut='global.toggleRightSidebar'>
          <Button
            variant='ghost'
            size='sm'
            className={cn('h-7 w-7 rounded-lg', actionIconClass)}
            onClick={resolvedOnClose ?? handleCloseTicketDetailsThread}
            aria-label='Close thread panel'
            data-track-category='THREAD_PANEL'
            data-track-name='CLOSE_THREAD_PANEL'
            data-track-metadata={JSON.stringify({ conversationId })}
          >
            <MultipleCrossCancelDefault size={16} />
          </Button>
        </ShortcutTooltip>
      )}
    </div>
  );

  return (
    <ConversationTabContext.Provider value={conversationTabContextValue}>
      <div
        className={`flex-1 h-full flex flex-col bg-background overflow-hidden relative ${
          isInPanelWebview ? '' : 'rounded-lg'
        }`}
        ref={dragAndDropAreaRef}
      >
        {/* Drag and Drop Overlay */}
        <DragAndDropOverlay isVisible={isDragging} />
        {/* pt-3 only (not py-3): a second padded header always follows this one, and its
            own pt-3 supplies the 12px below — py-3 here would double it to 24px. */}
        {showHeader && (
          <div className='flex gap-2 items-center justify-between w-full pl-2 pr-3 pt-3'>
            <div className='flex gap-2 items-center min-w-0'>
              <ArrowTurnDownRight size={16} className='flex-shrink-0' />
              <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0'>
                {isTicketThread && ticket ? ticket.title : 'Thread message'}
              </h3>
            </div>

            {derivedConversationId && (
              <Tooltip content='Toggle notification subscription'>
                <ConversationSubscription
                  conversationId={derivedConversationId}
                  {...(conversation && { conversation })}
                  variant='icon-only'
                  className={cn(
                    'h-7 w-7 rounded-lg flex items-center justify-center transition-colors hover:bg-accent dark:hover:bg-accent/50',
                    actionIconClass,
                  )}
                />
              </Tooltip>
            )}
          </div>
        )}
        {/* pt-3 only — the tabs header below supplies the 12px gap. See note above. */}
        {derivedTicketId && ticket && !simpleView && !headerActionsContainer && (
          <div className='flex justify-between items-center w-full pl-2 pr-3 pt-3 gap-4'>
            <div className='flex gap-2 items-center min-w-0 flex-1'>
              <Tooltip content='Copy ticket ID'>
                <button
                  type='button'
                  onClick={handleCopyTicketId}
                  aria-label={`Copy ticket ID ${ticket.xyneId}`}
                  data-track-category='THREAD_PANEL'
                  data-track-name='COPY_TICKET_ID'
                  className='text-xs font-medium text-muted-foreground bg-muted hover:bg-muted/70 px-2 py-0.5 rounded flex-shrink-0 cursor-pointer select-text transition-colors'
                >
                  {ticket.xyneId}
                </button>
              </Tooltip>
              <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-foreground'>
                {ticket.title}
              </h3>
              {focusedChannelBreadcrumb}
            </div>
            <div className='flex gap-x-2 shrink-0'>
              {/* Ask AI */}
              {!isStandaloneWindow() && (
                <Tooltip content='Ask AI Conversation'>
                  <Button
                    size='sm'
                    variant='ghost'
                    onClick={() => {
                      if (onAskAI) {
                        onAskAI(threadInfo ?? undefined);
                        return;
                      }
                      xyneAIActor.send({
                        type: 'OPEN',
                        channelId: derivedChannelId,
                        threadInfo,
                      });
                    }}
                    data-track-category='THREAD_PANEL'
                    data-track-name='OPEN_XYNE_AI_FROM_THREAD'
                    className='h-7 w-7 rounded-lg'
                  >
                    <XyneAIStar />
                  </Button>
                </Tooltip>
              )}
              {/* Initiate Call Button */}
              {derivedConversationId && (
                <ThreadCallButton
                  onStartCall={handleInitiateCall}
                  onScheduleCall={() => setIsScheduleCallModalOpen(true)}
                  hasActiveCall={hasActiveCallForConversation}
                  trackCategory='THREAD_PANEL'
                  trackName='INITIATE_CALL_FROM_THREAD'
                  trackMetadata={{ channelId: channel?.id, conversationId: derivedConversationId }}
                />
              )}
              {/* Start Recording (Take Notes) Button */}
              {derivedConversationId && (
                <ThreadRecordingButton
                  onStartRecording={handleStartRecordingFromThread}
                  hasActiveRecording={recordingStatus !== 'idle' && recordingStatus !== 'error'}
                  trackCategory='THREAD_PANEL'
                  trackName='START_RECORDING_FROM_THREAD'
                  trackMetadata={{ channelId: channel?.id, conversationId: derivedConversationId }}
                />
              )}
              {/* Overflow menu */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className={cn(
                      'flex items-center justify-center rounded-lg size-7 hover:bg-accent transition-colors shrink-0',
                      actionIconClass,
                    )}
                    title='More'
                    data-testid='thread-more-options-button'
                  >
                    <ThreeDotsMenuVertical size={16} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align='end'
                  onCloseAutoFocus={e => e.preventDefault()}
                  className='min-w-[180px]'
                >
                  {derivedConversationId && (
                    <DropdownMenuItem className='p-0' onSelect={e => e.preventDefault()}>
                      <ConversationSubscription
                        conversationId={derivedConversationId}
                        {...(conversation && { conversation })}
                        variant='dropdown'
                        menuOpen
                        className='px-2 py-1.5'
                      />
                    </DropdownMenuItem>
                  )}
                  {!isMobile && (
                    <DropdownMenuItem
                      className='gap-2'
                      onClick={openTicketDetailsExpandedView}
                      data-track-category='THREAD_PANEL'
                      data-track-name='OPEN_TICKET_EXPANDED_VIEW'
                    >
                      <MaximizeTwoArrow size={16} className='shrink-0' />
                      <span className='flex-1'>Expand view</span>
                    </DropdownMenuItem>
                  )}
                  {showThreadTags && !channel?.isArchived && (
                    <DropdownMenuSub>
                      <DropdownMenuSubTrigger
                        className='gap-2'
                        data-track-category='THREAD_PANEL'
                        data-track-name='OPEN_THREAD_TAG_MENU'
                      >
                        <TagIcon size={16} className='shrink-0' />
                        <span className='flex-1'>Thread tags</span>
                        <ChevronRight size={16} className='shrink-0 text-muted-foreground' />
                      </DropdownMenuSubTrigger>
                      <DropdownMenuSubContent className='min-w-[220px]'>
                        <ThreadTagMenuItems
                          applied={parseThreadTypes(conversation?.threadType)}
                          onToggle={name => {
                            const applied = parseThreadTypes(conversation?.threadType);
                            void setThreadTypes(
                              applied.includes(name)
                                ? applied.filter(value => value !== name)
                                : [...applied, name],
                            );
                          }}
                        />
                      </DropdownMenuSubContent>
                    </DropdownMenuSub>
                  )}
                  {!isMobile && !channel?.isArchived && (
                    <DropdownMenuItem
                      className='gap-2'
                      onClick={handleAddContextClick}
                      data-track-category='THREAD_PANEL'
                      data-track-name='OPEN_CONTEXT_MENU'
                      data-track-metadata={JSON.stringify({
                        conversationId: derivedConversationId,
                      })}
                    >
                      <LinkHorizontal size={16} className='shrink-0' />
                      <span className='flex-1'>Add context to thread</span>
                    </DropdownMenuItem>
                  )}
                  {isElectronApp() && !isStandaloneWindow() && (
                    <DropdownMenuItem
                      className='gap-2'
                      onClick={openInNewWindow}
                      data-track-category='THREAD_PANEL'
                      data-track-name='OPEN_THREAD_IN_NEW_WINDOW'
                    >
                      <ExternalLinkSquare size={16} className='shrink-0' />
                      <span className='flex-1'>Open in new window</span>
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem
                    className='gap-2'
                    onClick={handleCopyTicketViewLink}
                    data-track-category='THREAD_PANEL'
                    data-track-name='COPY_TICKET_LINK'
                  >
                    <LinkSlant size={16} className='shrink-0' />
                    <span className='flex-1'>Copy ticket link</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              {!isThreadsRoute && (
                <Tooltip content='Close'>
                  <Button
                    onClick={resolvedOnClose ?? handleCloseTicketDetailsThread}
                    data-track-category='THREAD_PANEL'
                    data-track-name='CLOSE_TICKET_DETAILS_THREAD'
                    className={cn('h-7 w-7 rounded-lg', actionIconClass)}
                    variant='ghost'
                    size='sm'
                    aria-label='Close Thread Panel'
                  >
                    <MultipleCrossCancelDefault size={16} />
                  </Button>
                </Tooltip>
              )}
            </div>
          </div>
        )}
        {/* Ticket Thread with Tabs - only when NOT simpleView */}
        {!simpleView && derivedTicketId ? (
          /* Ticket Thread: Header with Tabs */
          <Tabs.Root
            value={activeTab}
            onValueChange={value => setActiveTab(value as TabType)}
            className='flex-1 flex flex-col h-full overflow-hidden'
          >
            {headerActionsContainer
              ? createPortal(simpleViewHeaderActions, headerActionsContainer)
              : null}
            {/* Header with title, close button, and tabs */}
            <div className='w-full pl-2 pr-3 py-3'>
              <div className='relative flex justify-between w-full'>
                {/* Tabs List */}
                <div className='overflow-x-auto no-scrollbar'>
                  <Tabs.List className='flex items-center justify-start gap-0.5 px-0.5'>
                    {tabs.map(tab => (
                      <Tabs.Trigger asChild key={tab.value} value={tab.value}>
                        <button
                          className={cn(
                            'flex items-center justify-center gap-2 px-2.5 py-1.5 rounded-lg whitespace-nowrap transition-colors duration-100 cursor-pointer',
                            activeTab === tab.value
                              ? 'bg-muted text-foreground'
                              : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                          )}
                        >
                          {tab.icon && <span className='shrink-0'>{tab.icon}</span>}
                          <span className='text-sm font-medium tracking-[-0.28px]'>
                            {tab.label}
                          </span>
                          {tab.count !== undefined && tab.count > 0 && (
                            <span className='text-xs bg-muted text-muted-foreground px-2 py-0.5 rounded-full'>
                              {tab.count}
                            </span>
                          )}
                        </button>
                      </Tabs.Trigger>
                    ))}
                  </Tabs.List>
                </div>
                {/* Action Buttons */}
                <div className='flex items-center justify-end gap-1'>
                  {/* Close Button */}
                  {!isThreadsRoute &&
                    !headerActionsContainer &&
                    isTicketThread &&
                    (resolvedOnClose ? (
                      <Button
                        variant='ghost'
                        size='sm'
                        onClick={resolvedOnClose}
                        data-track-category='THREAD_PANEL'
                        data-track-name='CLOSE_THREAD_PANEL'
                        aria-label='Close thread panel'
                      >
                        <X size={20} />
                      </Button>
                    ) : (
                      <button
                        onClick={handleCloseTicketDetailsThread}
                        className='p-1 rounded-md text-muted-foreground hover:text-muted-foreground hover:bg-accent transition-colors duration-200'
                        aria-label='Close thread panel'
                        data-track-category='THREAD_PANEL'
                        data-track-name='CLOSE_THREAD_PANEL'
                        data-track-metadata={JSON.stringify({ conversationId })}
                      >
                        <X size={20} />
                      </button>
                    ))}
                </div>
              </div>
            </div>

            {/* Thread Tab Content */}
            <Tabs.Content
              value='thread'
              className='flex-1 flex flex-col h-full overflow-hidden data-[state=inactive]:hidden'
            >
              {isMessagesLoaded && !stableConversation && !!derivedConversationId ? (
                <div className='flex flex-col items-center justify-center flex-1 text-muted-foreground'>
                  <ChatDefault size={48} className='mb-2 opacity-40' />
                  <p className='text-sm'>No thread messages</p>
                </div>
              ) : (
                <>
                  <ThreadList
                    inspectedTag={inspectedTag}
                    channelId={derivedChannelId || ''}
                    conversationId={derivedConversationId || ''}
                    threadMessages={messages}
                    {...(onUserClick && { onUserClick })}
                    messagesWithSeparators={messagesWithSeparators}
                    initialScrollOffset={0}
                    isTicketThread={true}
                    spawnedTicketMessageIds={spawnedTicketMessageIds}
                    isFlowStep={isFlowStep}
                    channelScopeType={channel?.scopeType}
                    conversation={conversation}
                    enableCollapsing={previewCardMode}
                    enableJumpFab={!previewCardMode}
                    isMessagesLoaded={isMessagesLoaded}
                    {...(disableAskAI !== undefined && { disableAskAI })}
                    conversationParticipant={conversationParticipant}
                  />

                  {/* ChatInput at the bottom - only show if user is a member */}
                  {isUserMember || channel?.isArchived ? (
                    <div className='pb-3 bg-background shrink-0 px-[var(--composer-px)] [--composer-px:0.75rem]'>
                      <ChatInput
                        ref={inputRef}
                        channelId={derivedChannelId}
                        conversation={conversation ?? undefined}
                        placeholder='Reply to this thread...'
                        hasTicket={hasTicketInMessages}
                        threadParticipantIds={threadParticipantIds}
                        dockSlot={twinDock}
                        twinEdit={twinEditSession}
                      />
                    </div>
                  ) : previewCardMode && assist.hasReply ? (
                    <div className='px-4 pb-4 bg-background'>{twinDockCard}</div>
                  ) : (
                    <JoinChannel
                      channelId={derivedChannelId}
                      {...(channel?.name && { channelTitle: channel.name })}
                    />
                  )}
                </>
              )}
            </Tabs.Content>

            {/* Details Tab Content */}
            <Tabs.Content
              value='details'
              className='flex-1 min-h-0 bg-background overflow-hidden data-[state=inactive]:hidden'
            >
              <TicketDetails ticketId={derivedTicketId} onFillRCA={() => setActiveTab('rca')} />
            </Tabs.Content>

            {/* RCA Tab Content */}
            {isFixTicket && (
              <Tabs.Content
                value='rca'
                className='flex-1 overflow-hidden bg-background data-[state=inactive]:hidden'
              >
                <RCAPanelView ticketId={derivedTicketId} />
              </Tabs.Content>
            )}

            {/* Files Tab Content */}
            <Tabs.Content
              value='files'
              className='flex-1 overflow-auto bg-background p-4 data-[state=inactive]:hidden'
            >
              {files.length === 0 ? (
                <div className='flex flex-col items-center justify-center h-full text-muted-foreground'>
                  <FileText size={48} className='mb-2 text-muted-foreground' />
                  <p>No files in this thread</p>
                </div>
              ) : (
                <div className='space-y-3'>
                  {files.map((file, idx) => (
                    <FileBubble
                      key={`${file.attachment.id}-${idx}`}
                      createdBy={file.attachment.createdBy}
                      createdAt={file.attachment.createdAt}
                      attachment={file.attachment}
                      siblings={fileAttachments}
                    />
                  ))}
                </div>
              )}
            </Tabs.Content>
          </Tabs.Root>
        ) : (
          /* Regular Thread or Simple View */
          <>
            {/* Header with tabs for simpleView, or simple header for regular view */}
            {!hideHeader && (
              <div
                className='flex justify-between items-center w-full pl-2 pr-3 pt-3 gap-4'
                style={isDraggableThreadPanel ? APP_DRAG_STYLE : undefined}
              >
                {/* Title */}
                <div className='flex items-center gap-2 min-w-0 flex-1'>
                  {isStandaloneWindow() && (
                    <Tooltip content='Back to channel'>
                      <Button
                        variant='ghost'
                        size='sm'
                        className={cn('h-7 w-7 rounded-lg shrink-0', actionIconClass)}
                        style={APP_NO_DRAG_STYLE}
                        onClick={() => void navigate(`/newWindow/chat/dir/${derivedChannelId}`)}
                        data-track-category='THREAD_PANEL'
                        data-track-name='BACK_TO_CHANNEL'
                        aria-label='Back to channel'
                      >
                        <ArrowLeft size={16} />
                      </Button>
                    </Tooltip>
                  )}
                  {/* Thread indicator — shown when summarizing, or in focused mode so the
                      header reads like Slack's "↳ Thread #channel". */}
                  {!simpleView && (isThreadSummaryActive || isFocusedThread) && (
                    <ArrowTurnDownRight size={16} className='text-muted-foreground shrink-0' />
                  )}
                  <h3 className='text-[17px] font-semibold whitespace-nowrap overflow-hidden text-ellipsis min-w-0 text-foreground'>
                    {simpleView
                      ? 'Thread'
                      : isTicketThread && ticket
                        ? ticket.title
                        : 'Thread message'}
                  </h3>
                  {/* Classifies the whole thread, so it belongs beside the title rather
                      than against any one message. */}
                  {!simpleView && (
                    <ThreadTags
                      conversationId={derivedConversationId}
                      threadType={conversation?.threadType}
                      canEdit
                      inspectedTag={inspectedTag}
                      onInspect={setInspectedTag}
                    />
                  )}
                  {!simpleView && focusedChannelBreadcrumb}
                </div>

                {/* Actions */}
                {!headerActionsContainer && simpleViewHeaderActions}
              </div>
            )}
            {headerActionsContainer
              ? createPortal(simpleViewHeaderActions, headerActionsContainer)
              : null}
            {isMessagesLoaded && !stableConversation && !!derivedConversationId ? (
              <div className='flex flex-col items-center justify-center flex-1 text-muted-foreground'>
                <ChatDefault size={48} className='mb-2 opacity-40' />
                <p className='text-sm'>No thread messages</p>
              </div>
            ) : (
              <>
                <ThreadList
                  inspectedTag={inspectedTag}
                  channelId={derivedChannelId || ''}
                  conversationId={derivedConversationId || ''}
                  threadMessages={messages}
                  {...(onUserClick && { onUserClick })}
                  initialScrollOffset={0}
                  isTicketThread={false}
                  channelScopeType={channel?.scopeType}
                  conversation={conversation}
                  enableCollapsing={previewCardMode}
                  enableJumpFab={!previewCardMode}
                  isMessagesLoaded={isMessagesLoaded}
                  {...(disableAskAI !== undefined && { disableAskAI })}
                  conversationParticipant={conversationParticipant}
                  matchedMessageId={matchedMessageId ?? null}
                />

                {/* ChatInput at the bottom - only show if user is a member */}
                {isUserMember || channel?.isArchived ? (
                  <div className='pb-3 bg-background shrink-0 px-[var(--composer-px)] [--composer-px:0.75rem]'>
                    <ChatInput
                      // eslint-disable-next-line jsx-a11y/no-autofocus
                      autoFocus={previewCardMode || skipInputAutoFocus ? null : 'end'}
                      ref={inputRef}
                      channelId={derivedChannelId}
                      conversation={conversation ?? undefined}
                      placeholder='Reply to this thread...'
                      hasTicket={hasTicketInMessages}
                      threadParticipantIds={threadParticipantIds}
                      dockSlot={twinDock}
                      twinEdit={twinEditSession}
                    />
                  </div>
                ) : previewCardMode && assist.hasReply ? (
                  <div className='px-4 pb-4 bg-background'>{twinDockCard}</div>
                ) : (
                  <JoinChannel
                    channelId={derivedChannelId}
                    {...(channel?.name && { channelTitle: channel.name })}
                  />
                )}
              </>
            )}
          </>
        )}
        {/* Context Search Menu */}
        {setIsContextMenuOpen && (
          <GlobalCommandMenu
            open={isContextMenuOpen}
            onOpenChange={setIsContextMenuOpen}
            contextSelectionMode
            contextItems={contextItems}
            onContextItemToggle={handleContextItemToggle}
            onContextSelectionConfirm={handleContextConfirm}
          />
        )}

        {/* Schedule Call Modal */}
        <ScheduleCallModal
          isOpen={isScheduleCallModalOpen}
          onClose={() => setIsScheduleCallModalOpen(false)}
          {...(derivedChannelId ? { channelId: derivedChannelId } : {})}
          {...(derivedConversationId ? { conversationId: derivedConversationId } : {})}
        />
        {/* BotBubble for ticket creation - only show if channel has projectId */}
        {channel?.projectId && messages && messages.length > 0 && messages[0] && conversation && (
          <BotBubble
            messageId={messages[0].messageId}
            messageContent={messages[0].content}
            channelId={derivedChannelId}
            context='thread'
            conversation={conversation}
            isModalOpen={isCreateTicketModalOpen}
            renderTicketCard={false}
            onModalOpenChange={setIsCreateTicketModalOpen}
            onTicketCreated={handleTicketCreated}
          />
        )}

        {/* Call Participants Selection Modal */}
        {derivedConversationId && (
          <CallParticipantsSelectionModal
            isOpen={showParticipantsModal}
            onClose={() => setShowParticipantsModal(false)}
            channelId={derivedChannelId}
            conversationId={derivedConversationId}
          />
        )}
      </div>
    </ConversationTabContext.Provider>
  );
};

export default ThreadMessages;
