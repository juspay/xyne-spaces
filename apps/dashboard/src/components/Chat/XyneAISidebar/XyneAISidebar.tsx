import { logger, Event as LogEvent } from '../../../utils/logger';
import {
  ReactElement,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { toast } from 'sonner';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useQuery as useZeroQuery } from '../../../hooks/useQuery';
import { queries } from '../../../zero/queries';
import { useSelf } from '../../../hooks/useUsers';
import type {
  CollectionSummary,
  CollectionRole,
} from '../../../services/Knowledge/collectionService';
import { Upload } from 'lucide-react';
import { useDragAndDropAreaRef } from '../../../hooks/useDragAndDropAreaRef';
import { apiInstance } from '../../../services/clients/apiClient';
import { useChannel, useAllVisibleChannels } from '../../../hooks/useChannels';
import { useXyneAIStream } from '../../../hooks/useXyneAIStream';
import { ChannelScopeType } from '@xyne/shared';
import { BASE_URL } from '../../../services/clients/apiClient';
import type { ConversationHistory as ConversationHistoryType } from './utils/XyneAITypes';
import { resolveActivePath, getSiblings, BRANCH_ROOT_KEY } from './utils/XyneAIUtils';
import { useV2SessionsList, useV2SessionInvalidator } from '../../../hooks/useAskAISessionsV2';
import {
  deleteV2Conversation,
  fetchV2ConversationMessages,
  deskAutoDraftMessagesUrl,
  forkDeskAutoDraft,
} from '../../../services/XyneAI/XyneAISessionsV2Service';
import type {
  Message,
  SummarizerCitation,
  MessageAttachment,
  UserTag,
  DebugEventRecord,
} from './utils/XyneAITypes';
import { buildCitationUrl } from './utils/citationUrlBuilder';
import { attachmentCitationPreviewStore } from '../../FileViewer/AttachmentCitationPreview';
import {
  trackCitationClicked,
  trackWebSearchQuery,
  trackDeepResearchQuery,
  trackCanvasModeQuery,
  trackAttachmentsAdded,
} from '../../../services/otel/xyneAIMetrics';
import { AILandingHero, AILandingHeroErrorBoundary } from './components/AILandingHero';
import { XyneAIEmptyState } from './components/XyneAIEmptyState';
import { cn } from '../../../utils/classNames';
import { type Attachment } from './components/XyneAIInputBox';
import { XyneAIInputSection } from './components/XyneAIInputSection';
import {
  type SelectedChannel,
  type SelectedTicket,
  type SelectedCanvas,
  type SelectedTranscript,
  type SelectedRecording,
  type ContextSelections,
  toAttachedContext,
  attachedContextToSelections,
} from './components/ContextPickerPanel';
import { MessageItem, ConversationToolInvocationsContext } from './components/MessageItem';
import { ConversationHistory } from './components/ConversationHistory';
import { XyneAIHeader } from './components/XyneAIHeader';
import { XyneAIOnboardingHeader } from './components/XyneAIOnboardingHeader';
import { useAIOnboarding, ALL_ONBOARDING_SUGGESTIONS } from '../../../contexts/AIOnboardingContext';
import { XyneAIStar } from '../../icons/xyne-ai';
import { UserActivityPanel } from './components/UserActivityPanel';
import { AskAIDebugPanel } from './components/AskAIDebugPanel';
import type { UserActivity } from '../../../hooks/useUserActivity';
import { usePlatform } from '../../../hooks/usePlatform';
import { useSelectedAgent } from '../../../hooks/useSelectedAgent';
import { fetchAccessibleClawAgents } from '../../../services/clawAgentListService';
import { fetchClawAgentModels } from '../../../services/clawAgentModelsService';
import {
  xyneAIActor,
  type ThreadInfo,
  type CanvasInfo,
  type XyneAIContext,
  type AskAIInitialContextSelections,
  type SelectionInfo,
  type XyneAIResearchContext,
  flattenCanvasContexts,
} from '../../../machines/xyneAIMachine';
import { xyneAIStreamManager } from '../../../services/XyneAI';
import {
  buildXyneAIStreamThreadId,
  getChannelIdFromStreamThreadId,
} from '../../../utils/xyneAIStreamThreadId';

function newStreamSlotKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `draft-${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

const DEBUGGER_WIDTH_STORAGE_KEY = 'ask-ai-debug-width';

interface XyneAIConfigResponse {
  webSearchAccessible: boolean;
  deepResearchAccessible: boolean;
  v2Enabled?: boolean;
}

interface XyneAISidebarProps {
  channelId: string | null;
  threadInfo?: ThreadInfo | null;
  startFreshChat?: boolean;
  canvasInfo?: CanvasInfo | null;
  /** Context supplied by the surface that opened this Ask AI conversation. */
  initialContextSelections?: AskAIInitialContextSelections | null;
  /** Re-applies the supplied context on every explicit Ask AI open. */
  contextOpenNonce?: number;
  variant?: 'sidebar' | 'fullscreen';
  onClose?: () => void;
  preserveStreamingOnClose?: boolean;
  hideHeaderClose?: boolean;
  denseHeader?: boolean;
  debuggerPresentation?: 'split' | 'replace';
  onDebuggerOpenChange?: (open: boolean) => void;
  initialConversationId?: string;
  onConversationChange?: (conversationId: string) => void;
  kbCollectionId?: string;
  kbChannelId?: string;
  kbDocId?: string;
  kbDocName?: string;
  kbFolderId?: string;
  kbFolderName?: string;
  // Bumped by xyneAIMachine each time OPEN is dispatched with a kbCollectionId.
  // The input box re-attaches the KB collection chip on every bump.
  kbOpenNonce?: number;
  visible?: boolean;
  // Locks the sidebar to one Claw agent instead of the app-wide selected-agent store (for embedded/isolated instances).
  forcedAgentSlug?: string | null;
  // Seed text for the input box; bump autoSendNonce to submit it as a real message.
  initialQuery?: string | undefined;
  autoSendNonce?: number;
  researchContext?: XyneAIResearchContext | null;
  // Reports whether the active conversation is streaming, so an embedding caller can mute its own controls.
  onStreamingChange?: (isStreaming: boolean) => void;
  // Reports the latest completed bot message's final text (no reasoning), for embedding callers.
  onFinalResponse?: (content: string) => void;
}

const XyneAISidebar = ({
  channelId,
  threadInfo,
  canvasInfo,
  initialContextSelections,
  contextOpenNonce,
  startFreshChat = false,
  variant = 'sidebar',
  onClose,
  preserveStreamingOnClose = false,
  hideHeaderClose = false,
  denseHeader = false,
  debuggerPresentation = 'split',
  onDebuggerOpenChange,
  initialConversationId,
  onConversationChange,
  kbCollectionId: kbCollectionIdProp,
  kbDocId: kbDocIdProp,
  kbDocName: kbDocNameProp,
  kbFolderId: kbFolderIdProp,
  kbFolderName: kbFolderNameProp,
  kbOpenNonce,
  visible = true,
  forcedAgentSlug,
  initialQuery,
  autoSendNonce,
  researchContext,
  onStreamingChange,
  onFinalResponse,
}: XyneAISidebarProps): ReactElement => {
  const isFullscreen = variant === 'fullscreen';
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string>('');
  const [streamThreadKey, setStreamThreadKey] = useState<string>(
    () => initialConversationId ?? newStreamSlotKey(),
  );
  const usesDraftStreamKeyRef = useRef(!initialConversationId);
  // Detach fn for the read-only live viewer attached on reload-mid-run (see
  // handleLoadConversation). Detached before re-attaching + on unmount.
  const liveViewerDetachRef = useRef<(() => void) | null>(null);
  useEffect(() => () => liveViewerDetachRef.current?.(), []);
  const [loadingHistorySessionId, setLoadingHistorySessionId] = useState<string | null>(null);
  const [streamingSessionIds, setStreamingSessionIds] = useState<string[]>([]);
  const [currentTraceId, setCurrentTraceId] = useState<string | undefined>();
  const [debugEvents, setDebugEvents] = useState<DebugEventRecord[]>([]);
  const [debugArtifactsReadyVersion, setDebugArtifactsReadyVersion] = useState(0);
  const [showDebugger, setShowDebugger] = useState(false);
  const [debugTurnIndex, setDebugTurnIndex] = useState<number | null>(null);
  // Branching-safe debugger selection: under sibling branches, the Nth visible
  // assistant is no longer the Nth run by time, so an index-based selector
  // routes to the wrong run. Pin selection by the message's AgentRun.sessionId
  // (carried on Message.debugSessionId from /messages runByMsgId). Falls back
  // to turn-index when not set (legacy rows, live streams pre-finalize).
  const [debugSessionId, setDebugSessionId] = useState<string | null>(null);
  // When the debugger is opened by clicking a generic auto-citation chip, this
  // holds the tool call to expand + scroll to. Cleared when opened any other way.
  const [debugFocusToolCallId, setDebugFocusToolCallId] = useState<string | null>(null);
  const [debuggerWidth, setDebuggerWidth] = useState(() => {
    if (typeof window === 'undefined') return 460;
    const persisted = Number(window.localStorage.getItem(DEBUGGER_WIDTH_STORAGE_KEY));
    return Number.isFinite(persisted) ? Math.max(460, Math.min(900, persisted)) : 460;
  });
  // Drag-to-resize the inline debugger panel. It is right-anchored, so dragging
  // the handle LEFT widens it. Clamped 460–900px and persisted to localStorage.
  const handleDebuggerResizeStart = useCallback(
    (e: ReactMouseEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startWidth = debuggerWidth;
      let latest = startWidth;
      const onMove = (ev: MouseEvent) => {
        latest = Math.max(460, Math.min(900, startWidth + (startX - ev.clientX)));
        setDebuggerWidth(latest);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        document.body.style.userSelect = '';
        try {
          window.localStorage.setItem(DEBUGGER_WIDTH_STORAGE_KEY, String(latest));
        } catch {
          /* ignore persistence failures */
        }
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.body.style.userSelect = 'none';
    },
    [debuggerWidth],
  );
  const [showHistorySidebar, setShowHistorySidebar] = useState(false);
  const [showUserActivityPanel, setShowUserActivityPanel] = useState(false);
  const [conversations, setConversations] = useState<ConversationHistoryType[]>([]);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'LIKE' | 'DISLIKE' | null>>({});
  const [isLoadingConversation, setIsLoadingConversation] = useState(
    !startFreshChat && !isFullscreen,
  );
  const [selectedChannels, setSelectedChannels] = useState<SelectedChannel[]>([]);
  const [showContextModal, setShowContextModal] = useState(false);
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  // File scope(s) — multi-select. Seeded with the file Ask AI was opened from
  // (via a file viewer); users can add/remove more from the picker.
  const [fileScopes, setFileScopes] = useState<{ id: string; name: string }[]>(
    kbDocIdProp ? [{ id: kbDocIdProp, name: kbDocNameProp || 'this file' }] : [],
  );
  // Re-sync the file scope on every KB-scoped OPEN, even when kbDocIdProp/Name
  // are unchanged. Without kbOpenNonce in the deps, removing the file chip and
  // clicking Ask AI on the same file again would not re-attach (props identical
  // → effect skipped). The machine bumps the nonce on every OPEN with a KB id.
  useEffect(() => {
    setFileScopes(kbDocIdProp ? [{ id: kbDocIdProp, name: kbDocNameProp || 'this file' }] : []);
  }, [kbDocIdProp, kbDocNameProp, kbOpenNonce]);
  // Folder scope(s) — multi-select, from the collection picker. Sent to
  // claw-auth as a single 'folder' attached_context pointer per id — NOT
  // expanded to a recursive file list here (xyneAIControllerV2.ts doesn't do
  // that); claw-auth resolves it itself, at Vespa-query time, since Vespa's
  // collectionId filter only ever matches a doc's ROOT collection and can't
  // filter on a folder id directly.
  // Seeded with the folder Ask AI was opened from (browsing inside a
  // sub-folder in the KB screen, not its root); re-synced below like
  // fileScopes so re-opening Ask AI from a folder re-attaches the chip even
  // after it was manually removed.
  const [folderScopes, setFolderScopes] = useState<{ id: string; name: string }[]>(
    kbFolderIdProp ? [{ id: kbFolderIdProp, name: kbFolderNameProp || 'this folder' }] : [],
  );
  useEffect(() => {
    setFolderScopes(
      kbFolderIdProp ? [{ id: kbFolderIdProp, name: kbFolderNameProp || 'this folder' }] : [],
    );
  }, [kbFolderIdProp, kbFolderNameProp, kbOpenNonce]);
  // Bumping autoSendNonce seeds inputValue from initialQuery; submitted once seeded (see effect near handleSubmit).
  const autoSendPendingQueryRef = useRef<string | null>(null);
  const lastAutoSendNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (autoSendNonce === undefined || autoSendNonce === lastAutoSendNonceRef.current) return;
    if (!initialQuery?.trim()) return;
    lastAutoSendNonceRef.current = autoSendNonce;
    autoSendPendingQueryRef.current = initialQuery;
    setInputValue(initialQuery);
  }, [autoSendNonce, initialQuery]);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [deepResearchEnabled, setDeepResearchEnabled] = useState(false);
  const [createCanvasEnabled, setCreateCanvasEnabled] = useState(false);
  const [activeThreadInfo, setActiveThreadInfo] = useState<ThreadInfo | null>(threadInfo ?? null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [selectedActivities, setSelectedActivities] = useState<UserActivity[]>([]);
  const [selectedTickets, setSelectedTickets] = useState<SelectedTicket[]>([]);
  const [selectedCanvases, setSelectedCanvases] = useState<SelectedCanvas[]>([]);
  const [selectedTranscripts, setSelectedTranscripts] = useState<SelectedTranscript[]>([]);
  const [selectedRecordings, setSelectedRecordings] = useState<SelectedRecording[]>([]);
  const [browserContext, setBrowserContext] = useState<{
    type: 'browser';
    text: string;
    url: string;
    domain: string;
    title: string;
    timestamp: number;
  } | null>(null);
  const [activeSelectionInfos, setActiveSelectionInfos] = useState<SelectionInfo[]>([]);

  // A recording page already knows the exact call and notes canvas that should
  // scope the conversation. Seed the normal picker state so its visible pills
  // and the request payload use the same source of truth.
  useEffect(() => {
    if (!initialContextSelections) return;
    setSelectedCanvases(initialContextSelections.canvases);
    setSelectedTickets(initialContextSelections.tickets ?? []);
    setSelectedRecordings(initialContextSelections.recordings);
  }, [initialContextSelections, contextOpenNonce]);
  // Track the original channel where the current conversation was started
  // This prevents duplicate history entries when user switches channels during a query
  const [conversationChannelId, setConversationChannelId] = useState<string | null>(null);
  const [currentUserTags, setCurrentUserTags] = useState<Record<string, UserTag>>({});
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [branchSelections, setBranchSelections] = useState<Record<string, string>>({});
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const [sidebarContentWidth, setSidebarContentWidth] = useState(0);

  // Derive the active display path from the full message tree
  const displayMessages = useMemo(
    () => resolveActivePath(messages, branchSelections),
    [messages, branchSelections],
  );

  const isActiveSessionStreaming = useMemo(
    () => messages.some((m: Message) => m.isStreaming),
    [messages],
  );

  useEffect(() => {
    onStreamingChange?.(isActiveSessionStreaming);
  }, [isActiveSessionStreaming, onStreamingChange]);

  useEffect(() => {
    if (!onFinalResponse) return;
    const lastBot = [...messages].reverse().find((m: Message) => m.type === 'bot');
    if (lastBot && !lastBot.isStreaming && lastBot.content) {
      onFinalResponse(lastBot.content);
    }
  }, [messages, onFinalResponse]);

  // Per-render render-precompute hoisted out of the inline IIFE in JSX.
  // Two O(n) passes over `messages` and `displayMessages` that the JSX used to
  // do on every render — every streaming delta was triggering them, blowing
  // out the main thread on long conversations. They only depend on the two
  // message lists, so memoize and let React skip the work when nothing
  // actually changed since the last frame.
  const { lastBotIndex, lastUserIndex, siblingIndexById, siblingCountById } = useMemo(() => {
    let botIdx = -1;
    let userIdx = -1;
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (botIdx === -1 && displayMessages[i]?.type === 'bot') botIdx = i;
      if (userIdx === -1 && displayMessages[i]?.type === 'user') userIdx = i;
      if (botIdx !== -1 && userIdx !== -1) break;
    }
    const indexById = new Map<string, number>();
    const countById = new Map<string, number>();
    const groups = new Map<string, string[]>();
    for (const m of messages) {
      const key = m.parentId ?? BRANCH_ROOT_KEY;
      const group = groups.get(key);
      if (group) group.push(m.id);
      else groups.set(key, [m.id]);
    }
    for (const [, group] of groups) {
      group.forEach((id, i) => {
        indexById.set(id, i);
        countById.set(id, group.length);
      });
    }
    return {
      lastBotIndex: botIdx,
      lastUserIndex: userIdx,
      siblingIndexById: indexById,
      siblingCountById: countById,
    };
  }, [messages, displayMessages]);
  const streamingBotTurnIndex = useMemo(() => {
    const index = displayMessages.findIndex(
      message => message.type === 'bot' && message.isStreaming,
    );
    if (index < 0) return -1;
    return displayMessages.slice(0, index + 1).filter(message => message.type === 'bot').length - 1;
  }, [displayMessages]);

  // Keep the debugger pinned to the turn that is CURRENTLY streaming, so the
  // live trace never stays bound to a prior turn. Without this, on turns 2+ the
  // pin (debugTurnIndex/debugSessionId) lags on turn 1, `selectedTurnLive` goes
  // false, and the live block is gated out entirely. Fires only while a turn is
  // live (streamingBotTurnIndex >= 0); it's -1 when idle, so a manual selection
  // of an older turn after a run finishes is left intact.
  useEffect(() => {
    if (streamingBotTurnIndex >= 0) {
      setDebugTurnIndex(streamingBotTurnIndex);
      setDebugSessionId(null);
    }
  }, [streamingBotTurnIndex]);

  // Flat union of every visible message's toolInvocations. Powers
  // ConversationToolInvocationsContext so an inline citation chip rendered in
  // turn N can resolve a `toolCallId` that was emitted back in turn 1.
  // Keyed on the toolCallId set so a streaming delta that only mutates a
  // tool's payload doesn't churn this list's identity unless a tool was
  // added/removed.
  const conversationToolInvocations = useMemo(() => {
    const out: NonNullable<Message['toolInvocations']> = [];
    for (const m of displayMessages) {
      if (m.toolInvocations?.length) out.push(...m.toolInvocations);
    }
    return out;
  }, [displayMessages]);

  // Legacy conversation: no message has parentId — branching features disabled
  const isLegacyConversation = useMemo(
    () =>
      messages.length > 0 &&
      messages.every((m: Message) => m.parentId === null || m.parentId === undefined),
    [messages],
  );

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const { state: aiOnboarding, completeOnboarding } = useAIOnboarding();

  // Use drag and drop hook with the existing pattern
  const {
    dragAndDropAreaRef,
    inputRef: xyneAIInputRef,
    isDragging,
  } = useDragAndDropAreaRef(channelId ?? undefined);
  const { isMobile } = usePlatform();
  // If startFreshChat is true on mount, mark as loaded immediately to prevent loading old data
  const hasLoadedInitialConversationRef = useRef(startFreshChat || isFullscreen);

  // Find the ProseMirror editor element and focus it once it exists.
  // Retry via rAF because editor mount timing can vary across renders/routes.
  useEffect(() => {
    if (isMobile) return;
    let rafId: number | null = null;
    let attempts = 0;

    const resolveAndFocus = () => {
      const editorEl = dragAndDropAreaRef.current?.querySelector('.ProseMirror');
      if (editorEl instanceof HTMLElement) {
        editorEl.focus();
        return;
      }

      attempts += 1;
      if (attempts < 10) {
        rafId = requestAnimationFrame(resolveAndFocus);
      }
    };

    resolveAndFocus();

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [dragAndDropAreaRef, isMobile]);

  // Update activeThreadInfo when threadInfo prop changes
  const prevThreadConversationIdRef = useRef(threadInfo?.conversationId);
  useEffect(() => {
    setActiveThreadInfo(threadInfo ?? null);
    const newConvId = threadInfo?.conversationId;
    if (newConvId && prevThreadConversationIdRef.current !== newConvId) {
      prevThreadConversationIdRef.current = newConvId;
      hasLoadedInitialConversationRef.current = false;
      setMessages([]);
      setConversationId('');
      setBranchSelections({});
      setFeedbackMap({});
      setStreamThreadKey(newStreamSlotKey());
      usesDraftStreamKeyRef.current = true;
    }
  }, [threadInfo]);

  // Track processed selection keys to avoid duplicates
  const processedSelectionKeysRef = useRef<Set<string>>(new Set());

  // Sync processedSelectionKeysRef with activeSelectionInfos to handle removals
  useEffect(() => {
    // Build the current set of active selection keys
    const activeKeys = new Set(activeSelectionInfos.map(s => `${s.canvasId}-${s.text}`));
    // Remove keys from processedSelectionKeysRef that are no longer active
    // This allows re-adding the same selection if user removed it and selects again
    processedSelectionKeysRef.current = activeKeys;
  }, [activeSelectionInfos]);

  // Subscribe to xyneAIActor to receive canvasContexts
  useEffect(() => {
    // Function to process canvas contexts and extract selections
    const processCanvasContexts = (context: XyneAIContext): void => {
      // Flatten canvas contexts to get all selections
      const allSelections = flattenCanvasContexts(context.canvasContexts);

      if (allSelections.length > 0) {
        // Find new selections that haven't been processed
        const newSelections: SelectionInfo[] = [];

        for (const selection of allSelections) {
          const selectionKey = `${selection.canvasId}-${selection.text}`;

          if (!processedSelectionKeysRef.current.has(selectionKey)) {
            processedSelectionKeysRef.current.add(selectionKey);
            newSelections.push(selection);
          }
        }

        // Add new selections to existing ones
        if (newSelections.length > 0) {
          setActiveSelectionInfos(prev => [...prev, ...newSelections]);
        }
      }
    };

    // Check current state immediately (for cases where sidebar opens after the event)
    const currentSnapshot = xyneAIActor.getSnapshot();
    if (currentSnapshot) {
      processCanvasContexts(currentSnapshot.context);
    }

    // Subscribe to future changes
    const subscription = xyneAIActor.subscribe(snapshot => {
      processCanvasContexts(snapshot.context);
    });

    return () => {
      subscription.unsubscribe();
      // Clear processed selection keys on unmount to prevent memory leak
      processedSelectionKeysRef.current.clear();
    };
  }, []);

  useEffect(() => {
    xyneAIStreamManager.setVisibleConversationId(conversationId || null);
  }, [conversationId]);

  useEffect(() => {
    const syncStreaming = (): void => {
      setStreamingSessionIds(xyneAIStreamManager.getStreamingSessionIds());
    };
    syncStreaming();
    return xyneAIStreamManager.subscribe(() => syncStreaming());
  }, []);

  // Notify stream manager when the sidebar is actually visible. Hidden keep-alive
  // mounts preserve live subscriptions while the drawer is closed, but should
  // still count as closed for completion-toast logic.
  useEffect(() => {
    xyneAIStreamManager.setSidebarOpen(visible);
    return () => {
      xyneAIStreamManager.setSidebarOpen(false);
    };
  }, [visible]);

  const channel = useChannel(channelId || '');

  const channelName = (channel?.['name'] as string) || '';

  const channelDescription = (channel?.['description'] as string) || '';

  const scopeType = (channel?.['scopeType'] as string) || '';

  const allChannels = useAllVisibleChannels();
  const nonDMChannels = useMemo(
    () =>
      allChannels.filter(
        ch => ch.scopeType !== ChannelScopeType.DM && ch.scopeType !== ChannelScopeType.GROUP_DM,
      ),
    [allChannels],
  );

  const currentUser = useSelf();
  // Load ALL collections the user can access (no scope), so the Ask AI picker works
  // from anywhere in the chat — not only from /knowledge-base. (scopedCollections
  // with {} = global; with { scopeType, scopeId } it scopes to a channel.)
  const [zeroCollections] = useZeroQuery(queries.scopedCollections({}), !!currentUser?.id);
  const collectionsList: CollectionSummary[] = useMemo(() => {
    if (!zeroCollections || !currentUser?.id) return [];
    return zeroCollections.map(col => {
      const perm = col.permissions?.find(p => p.userId === currentUser.id);
      return {
        id: col.id,
        name: col.name,
        description: col.description ?? null,
        ownerId: col.ownerId,
        role: (perm?.role ??
          (col.ownerId === currentUser.id ? 'OWNER' : 'VIEWER')) as CollectionRole,
        canShare: perm?.canShare ?? col.ownerId === currentUser.id,
      };
    });
  }, [zeroCollections, currentUser?.id]);

  // Initialize selectedChannels with current channel (if not DM/GROUP_DM) on mount
  useEffect(() => {
    if (
      channelId &&
      channelName &&
      scopeType !== (ChannelScopeType.DM as string) &&
      scopeType !== (ChannelScopeType.GROUP_DM as string)
    ) {
      const ch = allChannels.find(c => c.id === channelId);
      setSelectedChannels([
        {
          id: channelId,
          name: channelName,
          isPrivate: ch ? String(ch.visibility) === 'PRIVATE' : false,
        },
      ]);
    }
    // Only on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Repository-scoped SDLC chat is stricter than global Ask AI: entering the
  // hub or switching its repository must replace the primary channel instead
  // of preserving the channel chip from the previously-open global chat.
  useEffect(() => {
    if (researchContext?.type !== 'repository') return;
    if (
      !channelId ||
      !channelName ||
      scopeType === (ChannelScopeType.DM as string) ||
      scopeType === (ChannelScopeType.GROUP_DM as string)
    ) {
      setSelectedChannels([]);
      return;
    }
    const channel = allChannels.find(item => item.id === channelId);
    const nextChannel: SelectedChannel = {
      id: channelId,
      name: channelName,
      isPrivate: channel ? String(channel.visibility) === 'PRIVATE' : false,
    };
    setSelectedChannels(previous => {
      const current = previous[0];
      return previous.length === 1 &&
        current?.id === nextChannel.id &&
        current.name === nextChannel.name &&
        current.isPrivate === nextChannel.isPrivate
        ? previous
        : [nextChannel];
    });
  }, [allChannels, channelId, channelName, researchContext, scopeType]);

  // Fetch web search configuration from backend
  const { data: configData } = useQuery<XyneAIConfigResponse>({
    queryKey: ['xyne-ai-config'],
    queryFn: async (): Promise<XyneAIConfigResponse> => {
      const response = await apiInstance.get<XyneAIConfigResponse>('/xyne-ai/config');
      return response.data;
    },
  });

  const webSearchAccessible = configData?.webSearchAccessible ?? false;
  const deepResearchAccessible = configData?.deepResearchAccessible ?? false;

  // When forcedAgentSlug is set, reads/writes bypass the app-wide agent-selector store.
  const isAgentForced = forcedAgentSlug !== undefined;
  const {
    selectedAgentSlug: globalSelectedAgentSlug,
    setSelectedAgentSlug: setGlobalSelectedAgentSlug,
  } = useSelectedAgent();
  const selectedAgentSlug = isAgentForced ? forcedAgentSlug : globalSelectedAgentSlug;
  const setSelectedAgentSlug = useCallback(
    (slug: string | null) => {
      if (isAgentForced) return;
      setGlobalSelectedAgentSlug(slug);
    },
    [isAgentForced, setGlobalSelectedAgentSlug],
  );
  const { data: accessibleAgents = [] } = useQuery({
    queryKey: ['accessible-claw-agents'],
    queryFn: fetchAccessibleClawAgents,
    staleTime: 60_000,
  });

  // Ask AI v1 has been removed; everything runs on v2 (xyne-claw) now.
  const isV2 = true;
  const effectiveAgentSlug = selectedAgentSlug;
  // Per-run model pin. The model list is scoped to the AGENT's LiteLLM key, so
  // it refetches per agent and the pin resets on agent change — a model from
  // the previous agent's key may not exist on the new one.
  const modelAgentSlug = effectiveAgentSlug ?? 'ask-ai';
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<
    'off' | 'minimal' | 'low' | 'medium' | 'high' | null
  >(null);
  const { data: agentModelsData } = useQuery({
    queryKey: ['claw-agent-models', modelAgentSlug],
    queryFn: () => fetchClawAgentModels(modelAgentSlug),
    staleTime: 60_000,
    enabled: isV2,
  });
  useEffect(() => {
    setSelectedModel(null);
    setThinkingLevel(null);
  }, [modelAgentSlug]);

  useEffect(() => {
    onDebuggerOpenChange?.(showDebugger && isV2);
  }, [showDebugger, isV2, onDebuggerOpenChange]);
  // When selectedAgentSlug is null (Ask AI default), look for 'ask-ai' agent in v2 mode
  const selectedAgent = effectiveAgentSlug
    ? (accessibleAgents.find(a => a.slug === effectiveAgentSlug) ?? null)
    : isV2
      ? (accessibleAgents.find(a => a.slug === 'ask-ai') ?? null)
      : null;
  const selectedAgentName = selectedAgent?.name ?? null;

  // Ask AI v2 context-picker scope: when a claw agent is active, narrow the
  // collections list to what THAT agent can actually read.
  //   • v1 (selectedAgent === null) → unchanged, full list.
  //   • USER-scoped agent           → agent inherits caller's full KB, so
  //                                   showing the full list is the truthful
  //                                   reflection of agent reach.
  //   • COLLECTIONS-scoped agent    → filter to ids in agent.collections.
  //                                   A collection appears if there's a
  //                                   whole-collection grant OR a file-level
  //                                   grant within it (the agent can still
  //                                   read at least one doc inside).
  // The downstream MCP layer is the hard gate; this filter just keeps the
  // picker honest about what attaching a collection will get you.
  const effectiveCollectionsList: CollectionSummary[] = useMemo(() => {
    if (!selectedAgent) return collectionsList;
    if (selectedAgent.kbScope === 'USER') return collectionsList;
    // Top-level picker only lists ROOT collections — match against the
    // resolved rootCollectionId (claw-auth stores the file's immediate
    // parent, which can be a sub-folder).
    const allowedRoots = new Set((selectedAgent.collections ?? []).map(g => g.rootCollectionId));
    if (allowedRoots.size === 0) return [];
    return collectionsList.filter(c => allowedRoots.has(c.id));
  }, [collectionsList, selectedAgent]);

  // Auto-enable web search when browser context is provided (and user has access)
  // Web search stays enabled for the session to allow follow-up questions
  useEffect(() => {
    if (browserContext && webSearchAccessible && !webSearchEnabled) {
      setWebSearchEnabled(true);
    }
  }, [browserContext, webSearchAccessible, webSearchEnabled]);

  // Use the streaming hook with selected channel IDs, research context, and active thread info
  const { submitQuery, abortCurrentRequest } = useXyneAIStream({
    channelIds: selectedChannels.map(ch => ch.id),
    activities: selectedActivities,
    collectionIds: selectedCollectionIds ?? [],
    fileIds: fileScopes.map(f => f.id),
    folderIds: folderScopes.map(f => f.id),
    conversationId,
    streamSessionKey: streamThreadKey,
    threadConversationId: activeThreadInfo?.conversationId,
    attachmentIds: activeThreadInfo?.attachmentIds,
    canvasId: canvasInfo?.canvasId ?? null,
    setMessages,
    setConversationId,
    setCurrentTraceId,
    setDebugEvents,
    setDebugArtifactsReadyVersion,
    webSearchEnabled: webSearchAccessible ? webSearchEnabled : false,
    deepResearchEnabled: deepResearchAccessible ? deepResearchEnabled : false,
    researchContext: researchContext ?? null,
    createCanvasEnabled,
    isV2,
    suppressCompletionToast: isAgentForced,
    channelId: channelId || undefined, // Pass channelId for thread ID construction
    ticketIds: selectedTickets.map(t => t.id),
    canvasIds: selectedCanvases.map(c => c.id),
    callIds: [...selectedTranscripts.map(t => t.id), ...selectedRecordings.map(r => r.id)],
    attachedContext: toAttachedContext({
      channels: selectedChannels,
      tickets: selectedTickets,
      canvases: selectedCanvases,
      transcripts: selectedTranscripts,
      recordings: selectedRecordings,
    }),
    agentSlug: effectiveAgentSlug,
    model: selectedModel,
    modelProvider: selectedModel ? (agentModelsData?.pinProvider ?? 'litellm') : null,
    thinkingLevel,
  });

  // Start fresh chat when startFreshChat flag is set
  // This is triggered when XyneAI is invoked from "Ask AI" button
  useEffect(() => {
    if (startFreshChat) {
      // A forced-agent instance must not mutate the global xyneAIActor shared with the main sidebar.
      if (!isAgentForced) {
        xyneAIActor.send({ type: 'SET_FOCUS_SESSION', sessionId: null });
      }

      // Reset to fresh state (keeps threadInfo but clears messages/conversation)
      setMessages([]);
      setBranchSelections({});
      setConversationId('');
      setCurrentTraceId(undefined);
      setDebugEvents([]);
      setDebugArtifactsReadyVersion(0);
      setShowDebugger(false);
      setAttachments([]);
      setSelectedActivities([]);
      setShowHistorySidebar(false);
      setShowUserActivityPanel(false);

      hasLoadedInitialConversationRef.current = true;

      setStreamThreadKey(newStreamSlotKey());
      usesDraftStreamKeyRef.current = true;

      // Only reset the flag in the machine for non-KB instances (AppRoot sidebar)
      // KB inline sidebar doesn't use xstate, so skip this
      if (channelId !== null && !isAgentForced) {
        // Only update the xstate machine in sidebar mode (fullscreen manages its own lifecycle)
        if (!isFullscreen) {
          xyneAIActor.send({
            type: 'OPEN',
            ...(channelId && { channelId }),
            ...(threadInfo && { threadInfo }),
            ...(canvasInfo && { canvasInfo }),
            ...(researchContext && { researchContext }),
            startFreshChat: false,
          });
        }
      }
    }
  }, [
    startFreshChat,
    channelId,
    threadInfo,
    canvasInfo,
    researchContext,
    isFullscreen,
    isAgentForced,
  ]);

  // Scroll to bottom function
  const scrollToBottom = useCallback((): void => {
    // `block: 'nearest'` ALWAYS — not just for forced/embedded instances.
    messagesEndRef.current?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, []);

  // AI Onboarding: derive answered count and visible suggestions from messages
  // No context dispatches — avoids re-renders that interfere with streaming
  // Count completed bot responses (not streaming) for the "Done" button threshold
  const onboardingAnsweredCount = aiOnboarding.isActive
    ? messages.filter((m: Message) => m.type === 'bot' && !m.isStreaming).length
    : 0;

  const visibleSuggestions = useMemo(() => {
    if (!aiOnboarding.isActive) return [];
    const askedQuestions = new Set(
      messages.filter((m: Message) => m.type === 'user').map((m: Message) => m.content),
    );
    return ALL_ONBOARDING_SUGGESTIONS.filter(s => !askedQuestions.has(s)).slice(0, 3);
  }, [aiOnboarding.isActive, messages]);

  // v2 sessions hooks (xyne-claw backed)
  const { data: v2SessionsData, refetch: refetchV2Sessions } = useV2SessionsList(
    effectiveAgentSlug,
    isV2,
  );
  const { invalidateSessions: invalidateV2Sessions } = useV2SessionInvalidator();

  // Sync sessions list to local state for the ConversationHistory component
  useEffect(() => {
    if (v2SessionsData) {
      setConversations(v2SessionsData);
    }
  }, [v2SessionsData]);

  // Thread context: load thread-specific conversation (channel-specific)
  // Global context: load most recent conversation across all channels
  useEffect(() => {
    if (hasLoadedInitialConversationRef.current) {
      setIsLoadingConversation(false);
      return;
    }

    // For startFreshChat, skip loading and start fresh immediately
    if (startFreshChat) {
      hasLoadedInitialConversationRef.current = true;
      setIsLoadingConversation(false);
      setStreamThreadKey(newStreamSlotKey());
      usesDraftStreamKeyRef.current = true;
      return;
    }

    if (xyneAIActor.getSnapshot().context.focusSessionId) {
      hasLoadedInitialConversationRef.current = true;
      setIsLoadingConversation(false);
      return;
    }

    const loadMostRecentConversation = async (): Promise<void> => {
      try {
        setIsLoadingConversation(true);

        const threadConversationId = threadInfo?.conversationId;

        const latestLiveStream = xyneAIStreamManager.findLatestSidebarStream();
        if (isV2 && latestLiveStream) {
          setStreamThreadKey(latestLiveStream.streamSlotKey);
          usesDraftStreamKeyRef.current =
            latestLiveStream.streamSlotKey !== latestLiveStream.sessionId;
          setMessages(latestLiveStream.messages);
          setDebugEvents(latestLiveStream.debugEvents);
          setDebugArtifactsReadyVersion(latestLiveStream.debugArtifactsReadyVersion);
          if (latestLiveStream.agentSlug && latestLiveStream.agentSlug !== selectedAgentSlug) {
            setSelectedAgentSlug(latestLiveStream.agentSlug);
          }
          if (latestLiveStream.sessionId) {
            setConversationId(latestLiveStream.sessionId);
          }
          const originalChannelId = getChannelIdFromStreamThreadId(latestLiveStream.threadId);
          setConversationChannelId(originalChannelId);
          hasLoadedInitialConversationRef.current = true;
          setIsLoadingConversation(false);
          setTimeout(() => {
            scrollToBottom();
          }, 100);
          return;
        }

        // Global / channel-only / channel+thread: load session list first, then match active stream by session id
        if (isV2) {
          // Open a FRESH session by default instead of auto-loading the most
          // recent past conversation. Any in-flight stream was already resumed
          // above (findLatestSidebarStream), and past conversations remain
          // reachable via the history panel. A desk-ticket context
          // (threadConversationId) still loads its scoped chat.
          if (!threadConversationId) {
            hasLoadedInitialConversationRef.current = true;
            setStreamThreadKey(newStreamSlotKey());
            usesDraftStreamKeyRef.current = true;
            setIsLoadingConversation(false);
            return;
          }

          let v2Sessions = v2SessionsData;
          if (!v2Sessions) {
            const result = await refetchV2Sessions();
            v2Sessions = result.data;
          }

          hasLoadedInitialConversationRef.current = true;

          if (!v2Sessions || v2Sessions.length === 0) {
            setIsLoadingConversation(false);
            return;
          }

          // Load the most recent conversation's messages from claw
          const mostRecentConv = v2Sessions[0]!;
          setStreamThreadKey(mostRecentConv.sessionId);
          usesDraftStreamKeyRef.current = false;

          const streamTid = buildXyneAIStreamThreadId({
            channelId: channelId ?? null,
            threadConversationId: threadConversationId ?? null,
            streamSessionKey: mostRecentConv.sessionId,
          });
          const liveStream =
            xyneAIStreamManager.getActiveStream(streamTid) ??
            xyneAIStreamManager.findActiveStreamBySessionId(mostRecentConv.sessionId);

          if (liveStream) {
            setMessages(liveStream.messages);
            if (liveStream.sessionId) {
              setConversationId(liveStream.sessionId);
            }
            const originalChannelId = getChannelIdFromStreamThreadId(liveStream.threadId);
            setConversationChannelId(originalChannelId ?? mostRecentConv.channelId ?? null);
            setIsLoadingConversation(false);
            setTimeout(() => {
              scrollToBottom();
            }, 100);
            return;
          }

          const clawMessages = await fetchV2ConversationMessages(
            mostRecentConv.sessionId,
            effectiveAgentSlug,
          );
          const messagesWithoutStreaming: Message[] = clawMessages.map(msg => ({
            ...msg,
            isStreaming: false,
          }));
          setMessages(messagesWithoutStreaming);
          setConversationId(mostRecentConv.sessionId);
          setConversationChannelId(mostRecentConv.channelId || null);

          setTimeout(() => {
            scrollToBottom();
          }, 100);
        }

        // Scroll to bottom after loading
        setTimeout(() => {
          scrollToBottom();
        }, 100);
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[XyneAISidebar] Failed to load most recent conversation:'),
          error: error,
        });
      } finally {
        setIsLoadingConversation(false);
      }
    };

    void loadMostRecentConversation();
  }, [
    channelId,
    threadInfo?.conversationId,
    scrollToBottom,
    startFreshChat,
    isV2,
    v2SessionsData,
    refetchV2Sessions,
    selectedAgentSlug,
    effectiveAgentSlug,
    setSelectedAgentSlug,
  ]);

  // Refetch sessions list when history sidebar is opened to get fresh data
  useEffect(() => {
    if (showHistorySidebar) {
      void refetchV2Sessions();
    }
  }, [showHistorySidebar, refetchV2Sessions]);

  const handleSuggestionClick = (query: string): void => {
    setInputValue(query);
  };

  const handleLoadConversation = async (conversation: ConversationHistoryType): Promise<void> => {
    setLoadingHistorySessionId(conversation.sessionId);
    setStreamThreadKey(conversation.sessionId);
    setConversationId(conversation.sessionId);
    usesDraftStreamKeyRef.current = false;

    try {
      const threadConversationId = activeThreadInfo?.conversationId;
      const streamTid = buildXyneAIStreamThreadId({
        channelId: channelId ?? null,
        threadConversationId: threadConversationId ?? null,
        streamSessionKey: conversation.sessionId,
      });
      const live =
        xyneAIStreamManager.getActiveStream(streamTid) ??
        xyneAIStreamManager.findActiveStreamBySessionId(conversation.sessionId);

      // Adopt the live manager state for BOTH 'streaming' and 'completed' — as
      // long as the entry hasn't been swept (5 minute window after the
      // completeStream change). For completed streams this means we render the
      // just-finished reply instantly on switch-back with no /messages roundtrip
      // and no chance of the server missing the final bot message because the
      // assistant-message INSERT hasn't replicated yet. The streaming case also
      // keeps the live subscription wired so deltas continue to flow.
      if (live && (live.status === 'streaming' || live.status === 'completed')) {
        // Defense in depth: even after completeStream's per-message
        // isStreaming normalization, ensure no stray flag survives — older
        // streams that completed before the fix can still sit in IndexedDB.
        const normalized = live.messages.map(m =>
          live.status === 'completed' && m.isStreaming ? { ...m, isStreaming: false } : m,
        );
        setMessages(normalized);
        setDebugEvents(live.debugEvents);
        setDebugArtifactsReadyVersion(live.debugArtifactsReadyVersion);
        if (live.sessionId) {
          setConversationId(live.sessionId);
        }
        setConversationChannelId(conversation.channelId || null);
        setBranchSelections({});
        setEditingMessageId(null);
        setShowHistorySidebar(false);
        setFeedbackMap({});
        setTimeout(() => {
          scrollToBottom();
        }, 100);
        return;
      }

      if (isV2) {
        setDebugEvents([]);
        setDebugArtifactsReadyVersion(0);
        const deskDraft = deskAutoDraftRef.current;
        const clawMessages = await fetchV2ConversationMessages(
          conversation.sessionId,
          effectiveAgentSlug,
          deskDraft && deskDraft.conversationId === conversation.sessionId
            ? deskAutoDraftMessagesUrl(deskDraft.conversationId, deskDraft.channelId)
            : undefined,
        );
        // Overlay any local-only messages from the manager. If the user sent a
        // message in this conversation, switched away, came back AFTER the
        // 5-minute manager TTL but BEFORE the server-side message INSERT
        // committed, the /messages fetch will be missing it. The manager's
        // IndexedDB-backed messages cover that window.
        const liveForOverlay =
          xyneAIStreamManager.getActiveStream(streamTid) ??
          xyneAIStreamManager.findActiveStreamBySessionId(conversation.sessionId);
        const serverIds = new Set(clawMessages.map(m => m.id));
        const overlayed: Message[] = [...clawMessages];
        if (liveForOverlay) {
          for (const localMsg of liveForOverlay.messages) {
            if (!serverIds.has(localMsg.id)) {
              overlayed.push(localMsg);
            }
          }
        }
        const messagesWithoutStreaming: Message[] = overlayed.map(msg => ({
          ...msg,
          isStreaming: false,
        }));
        setMessages(messagesWithoutStreaming);
        seedContextFromMessages(messagesWithoutStreaming);
        setConversationId(conversation.sessionId);
        setConversationChannelId(conversation.channelId || null);
        setBranchSelections({});
        setEditingMessageId(null);
        setShowHistorySidebar(false);
        setFeedbackMap({});

        // Reload mid-run: no in-memory stream was adopted above, so attach a
        // read-only live viewer that streams an in-flight answer in. No-op if
        // the run already finished (the /live snapshot comes back empty).
        liveViewerDetachRef.current?.();
        liveViewerDetachRef.current = xyneAIStreamManager.attachLiveViewer(
          streamTid,
          conversation.sessionId,
          effectiveAgentSlug || 'ask-ai',
          messagesWithoutStreaming,
        );

        setTimeout(() => {
          scrollToBottom();
        }, 100);
      }
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAISidebar] Failed to load conversation:'),
        error: error,
      });
    } finally {
      setLoadingHistorySessionId(null);
    }
  };

  // Fullscreen: notify parent whenever the active session ID changes.
  const onConversationChangeRef = useRef(onConversationChange);
  useEffect(() => {
    onConversationChangeRef.current = onConversationChange;
  });
  useEffect(() => {
    if (conversationId && isFullscreen) {
      onConversationChangeRef.current?.(conversationId);
    }
  }, [conversationId, isFullscreen]);

  const handleDeleteConversation = async (conversation: ConversationHistoryType): Promise<void> => {
    try {
      await deleteV2Conversation(conversation.sessionId, effectiveAgentSlug);
      invalidateV2Sessions(effectiveAgentSlug);
      // If deleted conversation was active, clear messages
      if (conversation.sessionId === conversationId) {
        setMessages([]);
        setBranchSelections({});
        setConversationId('');
        setStreamThreadKey(newStreamSlotKey());
        usesDraftStreamKeyRef.current = true;
      }
    } catch (error) {
      logger.error(LogEvent.FRONTEND_ERROR, {
        type: 'migrated_console_error',
        message: String('[XyneAISidebar] Failed to delete conversation:'),
        error: error,
      });
    }
  };

  const handleNewChat = useCallback((): void => {
    // Clear machine focus first — otherwise the focus subscription sees stale focusSessionId
    // while conversationId is '' and re-loads the previous session (flicker).
    xyneAIActor.send({ type: 'SET_FOCUS_SESSION', sessionId: null });

    setStreamThreadKey(newStreamSlotKey());
    usesDraftStreamKeyRef.current = true;

    setMessages([]);
    setBranchSelections({});
    setConversationId('');
    setConversationChannelId(null);
    setCurrentTraceId(undefined);
    setDebugEvents([]);
    setDebugArtifactsReadyVersion(0);
    setShowDebugger(false);
    setInputValue('');
    setAttachments([]);
    setSelectedActivities([]);
    setActiveSelectionInfos([]);
    setEditingMessageId(null);
    setShowHistorySidebar(false);
    setShowUserActivityPanel(false);

    processedSelectionKeysRef.current.clear();
  }, []);

  // When user selects a different agent from the global selector,
  // reset to a fresh conversation scoped to that agent.
  const handleSelectAgent = useCallback(
    (slug: string | null): void => {
      if (!isV2) return;
      if (slug === selectedAgentSlug) return;
      setSelectedAgentSlug(slug);
      handleNewChat();
    },
    [isV2, selectedAgentSlug, setSelectedAgentSlug, handleNewChat],
  );

  // When user selects an agent from the history page, stay on history
  // and refresh the conversation list for that agent.
  const handleSelectAgentFromHistory = useCallback(
    (slug: string | null): void => {
      if (!isV2) return;
      if (slug === selectedAgentSlug) return;
      setSelectedAgentSlug(slug);
      // Clear active conversation but stay on history page
      setConversationId('');
      setMessages([]);
      setBranchSelections({});
      setStreamThreadKey(newStreamSlotKey());
      usesDraftStreamKeyRef.current = true;
      // Refresh sessions list for the new agent
      void refetchV2Sessions();
    },
    [isV2, selectedAgentSlug, setSelectedAgentSlug, refetchV2Sessions],
  );

  const handleLoadConversationRef = useRef(handleLoadConversation);
  handleLoadConversationRef.current = handleLoadConversation;

  // Fullscreen / parent-driven session id (no remount required)
  const prevFullscreenSessionRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!isFullscreen) return;
    if (initialConversationId === prevFullscreenSessionRef.current) return;
    prevFullscreenSessionRef.current = initialConversationId;

    if (!initialConversationId) {
      handleNewChat();
      return;
    }

    const stub: ConversationHistoryType = {
      id: initialConversationId,
      sessionId: initialConversationId,
      channelId: '',
      title: '',
      messages: [],
      createdAt: new Date(),
      lastUpdated: new Date(),
    };
    void handleLoadConversationRef.current(stub);
  }, [initialConversationId, isFullscreen, handleNewChat]);

  useEffect(() => {
    const processFocus = (focus: string | null | undefined): void => {
      if (!focus) return;
      if (focus === conversationId) {
        xyneAIActor.send({ type: 'SET_FOCUS_SESSION', sessionId: null });
        return;
      }
      const stub: ConversationHistoryType = {
        id: focus,
        sessionId: focus,
        channelId: '',
        title: '',
        messages: [],
        createdAt: new Date(),
        lastUpdated: new Date(),
      };
      void handleLoadConversationRef.current(stub);
      xyneAIActor.send({ type: 'SET_FOCUS_SESSION', sessionId: null });
    };
    const snap = xyneAIActor.getSnapshot().context;
    if (snap.deskAutoDraft) deskAutoDraftRef.current = snap.deskAutoDraft;
    processFocus(snap.focusSessionId);
    const sub = xyneAIActor.subscribe(snapshot => {
      if (snapshot.context.deskAutoDraft) deskAutoDraftRef.current = snapshot.context.deskAutoDraft;
      processFocus(snapshot.context.focusSessionId);
    });
    return () => sub.unsubscribe();
  }, [conversationId]);

  // Draft stream slot key → server session id once the first turn completes (keeps threadId stable mid-stream)
  useEffect(() => {
    if (!usesDraftStreamKeyRef.current || !conversationId) return;
    if (messages.some(m => m.isStreaming)) return;

    const oldTid = buildXyneAIStreamThreadId({
      channelId: channelId ?? null,
      threadConversationId: activeThreadInfo?.conversationId ?? null,
      streamSessionKey: streamThreadKey,
    });
    const newTid = buildXyneAIStreamThreadId({
      channelId: channelId ?? null,
      threadConversationId: activeThreadInfo?.conversationId ?? null,
      streamSessionKey: conversationId,
    });

    if (oldTid !== newTid) {
      // v1: the backend mints a fresh server session id (id changed) — migrate
      // the threadId onto it and promote out of draft.
      xyneAIStreamManager.migrateThreadId(oldTid, newTid);
      setStreamThreadKey(conversationId);
      usesDraftStreamKeyRef.current = false;
    } else {
      // Same id, so there's nothing to migrate. Two cases land here:
      //   • v2 (claw reuses the client conversationId verbatim) after a turn
      //     completes — the slot is now server-backed, so promote out of draft.
      //   • An errored/never-established first turn (e.g. offline): conversationId
      //     is still the seeded draft key. Do NOT promote — there's no real
      //     session yet, and the next submit clears the dead turn (handleSubmit).
      // Without promoting the v2 case, the draft flag would stay stuck and every
      // later turn would be wrongly treated as a fresh draft.
      const lastBot = [...messages].reverse().find(m => m.type === 'bot');
      if (!lastBot?.errorInfo) {
        usesDraftStreamKeyRef.current = false;
      }
    }
  }, [messages, conversationId, streamThreadKey, channelId, activeThreadInfo?.conversationId]);

  const handleOpenContextModal = useCallback(() => setShowContextModal(true), []);
  const handleCloseContextModal = useCallback(() => {
    setShowContextModal(false);
    // Focus the input box after closing the modal
    setTimeout(() => {
      xyneAIInputRef.current?.focus();
    }, 0);
  }, [xyneAIInputRef]);
  const handleConfirmContext = useCallback((selections: ContextSelections) => {
    setSelectedChannels(selections.channels);
    setSelectedTickets(selections.tickets);
    setSelectedCanvases(selections.canvases);
    setSelectedTranscripts(selections.transcripts);
    setSelectedRecordings(selections.recordings);
  }, []);
  const handleRemoveChannel = useCallback((id: string) => {
    setSelectedChannels(prev => prev.filter(ch => ch.id !== id));
  }, []);
  const handleAddChannel = useCallback((ch: SelectedChannel) => {
    setSelectedChannels(prev => {
      if (prev.some(c => c.id === ch.id)) return prev;
      if (prev.length >= 5) return prev;
      return [...prev, ch];
    });
  }, []);
  const handleRemoveTicket = useCallback((id: string) => {
    setSelectedTickets(prev => prev.filter(t => t.id !== id));
  }, []);
  const handleRemoveCanvas = useCallback((id: string) => {
    setSelectedCanvases(prev => prev.filter(c => c.id !== id));
  }, []);
  const handleRemoveTranscript = useCallback((id: string) => {
    setSelectedTranscripts(prev => prev.filter(t => t.id !== id));
  }, []);
  const handleRemoveRecording = useCallback((id: string) => {
    setSelectedRecordings(prev => prev.filter(r => r.id !== id));
  }, []);

  // On switching to a conversation, carry its last user-turn context into the
  // composer so the input is pre-filled with the context last used there.
  // Context is chat-wise: REPLACE the editable context with this chat's last-turn
  // context, and CLEAR it when that turn had none — so one chat's context never
  // leaks into another. NOTE: collection PILLS are owned by XyneAIInputBox (only
  // ids reach the sidebar), so we sync the ids here for what's sent, but the
  // pill display for collections still only fully reflects on reload.
  const seedContextFromMessages = useCallback((msgs: Message[]): void => {
    const lastUser = [...msgs].reverse().find(m => m.type === 'user');
    const c = attachedContextToSelections(lastUser?.attachedContext ?? []);
    setSelectedChannels(c.channels);
    setSelectedTickets(c.tickets);
    setSelectedCanvases(c.canvases);
    setSelectedTranscripts(c.transcripts);
    setSelectedRecordings(c.recordings);
    setFileScopes(c.fileScopes);
    setFolderScopes(c.folderScopes);
    setSelectedCollectionIds(c.collections.map(col => col.id));
  }, []);

  const handleAddActivities = useCallback((activities: UserActivity[]): void => {
    if (activities.length === 0) return;
    setSelectedActivities(prev => {
      const existingIds = new Set(prev.map(a => a.id));
      const newActivities = activities.filter(a => !existingIds.has(a.id));
      const combined = [...prev, ...newActivities];
      return combined.sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
    });

    setShowUserActivityPanel(false);
  }, []);

  const handleFeedback = useCallback(
    async (messageId: string, feedbackType: 'LIKE' | 'DISLIKE'): Promise<void> => {
      // Toggle feedback - if already selected, deselect it
      const currentFeedback = feedbackMap[messageId];
      const newFeedback = currentFeedback === feedbackType ? null : feedbackType;

      // Update UI immediately
      setFeedbackMap(prev => ({
        ...prev,
        [messageId]: newFeedback,
      }));

      // Update the message with feedback value (1 for LIKE, 2 for DISLIKE)
      setMessages(prevMessages =>
        prevMessages.map(msg => {
          if (msg.id === messageId) {
            const { feedback: _removedFeedback, ...msgWithoutFeedback } = msg;
            if (newFeedback === 'LIKE') {
              return { ...msgWithoutFeedback, feedback: 1 };
            } else if (newFeedback === 'DISLIKE') {
              return { ...msgWithoutFeedback, feedback: 2 };
            }
            return msgWithoutFeedback;
          }
          return msg;
        }),
      );

      // Only make API call if setting feedback (not when removing)
      if (newFeedback && currentTraceId) {
        try {
          // eslint-disable-next-line local-rules/no-fetch-use-axios
          await fetch(`${BASE_URL}/xyne-ai/feedback`, {
            method: 'POST',
            headers: {
              // eslint-disable-next-line @typescript-eslint/naming-convention
              'Content-Type': 'application/json',
            },
            credentials: 'include',
            body: JSON.stringify({
              traceId: currentTraceId,
              value: newFeedback,
            }),
          });
        } catch (error) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[XyneAISidebar] Failed to submit feedback:'),
            error: error,
          });
          // Revert UI state on error
          setFeedbackMap(prev => ({
            ...prev,
            [messageId]: currentFeedback ?? null,
          }));
          // Revert message feedback
          setMessages(prevMessages =>
            prevMessages.map(msg => {
              if (msg.id === messageId) {
                const { feedback: _removedFeedback, ...msgWithoutFeedback } = msg;
                if (currentFeedback === 'LIKE') {
                  return { ...msgWithoutFeedback, feedback: 1 };
                } else if (currentFeedback === 'DISLIKE') {
                  return { ...msgWithoutFeedback, feedback: 2 };
                }
                return msgWithoutFeedback;
              }
              return msg;
            }),
          );
        }
      }
    },
    [feedbackMap, currentTraceId],
  );

  // v2 (claw) rating change — AskAiRatingButtons already persisted to
  // agent_runs; reflect the new feedback in local message state AND in the
  // stream manager's cache so the thumb survives a soft nav-away-and-back within
  // the stream TTL (which adopts the cached snapshot instead of refetching).
  const handleRatingChange = useCallback(
    (messageId: string, feedback: 0 | 1 | 2, comment?: string | null): void => {
      setMessages(prevMessages =>
        prevMessages.map(msg =>
          msg.id === messageId ? { ...msg, feedback, ratingComment: comment ?? null } : msg,
        ),
      );
      xyneAIStreamManager.patchMessageFeedback(messageId, feedback, comment ?? null);
    },
    [],
  );

  const handleCitationClick = useCallback(
    (
      messageNumber: number,
      conversationIdMapping: Record<string, string>,
      messageIdMapping: Record<string, string>,
      channelIdMapping?: Record<string, string>,
    ): void => {
      const convId = conversationIdMapping[String(messageNumber)];
      const msgId = messageIdMapping[String(messageNumber)];
      // Use channelId from mapping if available, otherwise fallback to current channelId
      const citationChannelId = channelIdMapping?.[String(messageNumber)] || channelId;

      if (!convId || !citationChannelId) return;

      trackCitationClicked('genius');

      // Navigate - XyneAI will stay open via xstate machine
      if (msgId) {
        void navigate(
          `/chat/dir/${citationChannelId}/${convId}#origin=${convId}&messageId=${msgId}`,
        );
      } else {
        void navigate(`/chat/dir/${citationChannelId}/${convId}`);
      }

      // Close XyneAI modal on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    },
    [channelId, navigate],
  );

  // Handle Summarizer citation clicks
  const handleSummarizerCitationClick = useCallback(
    (citation: SummarizerCitation): void => {
      // Attachment & Knowledge Base citations: open the file directly in the viewer modal
      if (
        (citation.entityType === 'attachment' || citation.entityType === 'knowledge_base') &&
        citation.entityId
      ) {
        // KB files are served from /collections/items/:itemId/download (not /attachments/:id/download)
        // fetchFile's resolveUrl passes through paths starting with '/', so we use the full path
        const attachmentId =
          citation.entityType === 'knowledge_base'
            ? `/collections/items/${citation.entityId}/download`
            : citation.entityId;
        attachmentCitationPreviewStore.open({
          attachmentId,
          fileName: citation.fileName ?? citation.entityId,
          mimeType: citation.mimeType ?? 'application/octet-stream',
          ...(citation.chunkPos !== undefined && { initialPage: citation.chunkPos }),
          ...(citation.chunkText && { chunkText: citation.chunkText }),
          ...(citation.chunkIndex !== undefined && { chunkIndex: citation.chunkIndex }),
        });
        trackCitationClicked('summarizer_attachment');
        if (isMobile) xyneAIActor.send({ type: 'CLOSE' });
        return;
      }

      // Build URL from citation metadata for all other entity types
      const url = buildCitationUrl(citation);

      if (!url) {
        logger.warn(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_warn',
          message: String('[XyneAI] Cannot build URL for citation:'),
          context: [citation],
        });
        return;
      }

      trackCitationClicked(citation.isExternal ? 'summarizer_external' : 'summarizer_internal');

      // Use explicit isExternal flag to determine routing behavior
      if (citation.isExternal) {
        // Open external citations (web search results) in new tab
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        // Navigate to internal entity citations
        void navigate(url);
      }

      // Close sidebar on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    },
    [navigate, isMobile],
  );

  // Regenerate: re-submit the same user query, creating a sibling bot branch
  const handleRegenerate = useCallback(async (): Promise<void> => {
    if (isActiveSessionStreaming) return;

    // Find last user message in the display path
    let lastUserMessage: Message | undefined;
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      if (displayMessages[i]?.type === 'user') {
        lastUserMessage = displayMessages[i];
        break;
      }
    }
    if (!lastUserMessage) return;

    abortCurrentRequest();

    // Submit with same content, parentId = user message ID (new bot branches as sibling of existing bot)
    await submitQuery(
      lastUserMessage.content,
      lastUserMessage.attachments ?? [],
      lastUserMessage.selectionContexts,
      lastUserMessage.content,
      undefined, // userTags — not needed for regenerate
      lastUserMessage.id, // parent is the user message itself — bot response branches from it
      true, // isRegenerate
    );
  }, [messages, displayMessages, submitQuery, abortCurrentRequest]);

  // Edit: create a sibling branch with new content from the same parent.
  // For v2 (claw) edits we must signal `isEditUserMessage` + `editedUserMessageId`
  // so claw-auth clones the PI session BEFORE the original user message
  // (otherwise the LLM keeps running on the same session and the pre-edit
  // assistant response leaks into the new turn's context — looks like a
  // follow-up before reload, flattens after). The JAF v1 path infers the
  // same intent from `parentMessageId`, so the extra params are no-ops there.
  const handleEditMessage = useCallback(
    async (messageId: string, newContent: string): Promise<void> => {
      if (isActiveSessionStreaming) return;

      const messageToEdit = messages.find((m: Message) => m.id === messageId);
      if (!messageToEdit || messageToEdit.type !== 'user') return;

      abortCurrentRequest();

      const editedParentAssistant = messageToEdit.parentId ?? undefined;

      // Submit with new content, parentId = original message's parent (creates sibling branch)
      await submitQuery(
        newContent,
        messageToEdit.attachments ?? [],
        messageToEdit.selectionContexts,
        newContent,
        undefined, // userTags — not needed for edit
        editedParentAssistant,
        undefined, // isRegenerate
        true, // isEditUserMessage — claw-auth branches PI session
        messageToEdit.id, // editedUserMessageId — the user msg being replaced
        editedParentAssistant, // parentAssistantMessageId — same as parentMessageId here
      );
    },
    [messages, abortCurrentRequest, submitQuery],
  );

  // Mobile edit: populate input box but keep messages intact until submit
  const handleEditMobile = useCallback(
    (messageId: string): void => {
      if (isActiveSessionStreaming) return;

      const message = messages.find((m: Message) => m.id === messageId);
      if (!message || message.type !== 'user') return;

      setInputValue(message.content);
      setEditingMessageId(messageId);
    },
    [messages],
  );

  // Navigate between branches at a given message
  const handleBranchNavigate = useCallback(
    (messageId: string, direction: 'prev' | 'next'): void => {
      const { siblings, currentIndex } = getSiblings(messages, messageId);
      if (siblings.length <= 1 || currentIndex === -1) return;

      const newIndex =
        direction === 'prev'
          ? (currentIndex - 1 + siblings.length) % siblings.length
          : (currentIndex + 1) % siblings.length;
      const newSibling = siblings[newIndex];
      if (!newSibling) return;

      const parentKey = newSibling.parentId ?? BRANCH_ROOT_KEY;
      setBranchSelections(prev => ({ ...prev, [parentKey]: newSibling.id }));
    },
    [messages],
  );
  const deskAutoDraftRef = useRef<{ conversationId: string; channelId: string } | null>(null);

  const handleSubmit = useCallback(async (): Promise<void> => {
    // Allow submission if there's input, activities, OR selection contexts
    if (!inputValue.trim() && selectedActivities.length === 0 && activeSelectionInfos.length === 0)
      return;

    const deskDraft = deskAutoDraftRef.current;
    if (deskDraft && deskDraft.conversationId === conversationId) {
      try {
        const forked = await forkDeskAutoDraft(deskDraft.conversationId, deskDraft.channelId);
        deskAutoDraftRef.current = null;
        setConversationId(forked.conversationId);
      } catch {
        toast.error('Could not continue this draft conversation');
        return;
      }
    }

    // Store the display content (what the user typed, without hidden context)
    const displayContent = inputValue.trim();

    // Build the full query with all context for the AI
    // Note: Activities are sent separately via attachedContext in useXyneAIStream, not in query
    let query = inputValue;

    // Add browser context if present (hidden from display but sent to AI)
    if (browserContext) {
      const contextText = `\n\n[Browser Context]\nSelected Text: "${browserContext.text}"\nFrom: ${browserContext.title} (${browserContext.url})\nDomain: ${browserContext.domain}`;
      query = query + contextText;
    }

    // Note: Selection text is NOT appended to query here - it's handled internally in useXyneAIStream
    // The user message will show original query + selectionContexts as visual cards

    const currentAttachments = attachments;

    // Track submission-time metrics
    if (webSearchEnabled) trackWebSearchQuery();
    if (deepResearchEnabled) trackDeepResearchQuery();
    if (createCanvasEnabled) trackCanvasModeQuery();
    if (currentAttachments.length > 0) trackAttachmentsAdded(currentAttachments.length);

    // Convert attachments to MessageAttachment format for display
    const messageAttachments: MessageAttachment[] = currentAttachments.map(att => ({
      filename: att.filename,
      mimeType: att.mimeType,
      data: att.data,
    }));

    // Build selection contexts for UI display and internal formatting
    const selectionContexts =
      activeSelectionInfos.length > 0
        ? activeSelectionInfos.map(selection => ({
            canvasId: selection.canvasId,
            selectedText: selection.text,
            preview: selection.preview,
            ...(selection.canvasTitle && { canvasTitle: selection.canvasTitle }),
          }))
        : undefined;

    // Stuck-draft recovery: a fresh draft slot still holding a completed turn
    // means the first turn ended without ever establishing a server session
    // (it errored/aborted before the sessionId arrived). A follow-up would be
    // inserted as a second parentless root and resolveActivePath would fork the
    // tree (phantom 1/2 branch arrows). The dead turn was never persisted — a
    // reload already shows only the surviving turn — so drop it and start the
    // retry as a clean single-chain conversation. Only clears local message
    // state (not streamThreadKey/conversationId), so the submitQuery closure
    // stays valid and live-stream routing is unaffected.
    if (
      !editingMessageId &&
      usesDraftStreamKeyRef.current &&
      messages.length > 0 &&
      !messages.some((m: Message) => m.isStreaming)
    ) {
      setMessages([]);
      setBranchSelections({});
    }

    // Determine parentMessageId for branching
    let parentMessageId: string | undefined;

    if (editingMessageId) {
      // Mobile edit: create sibling branch from same parent as the edited message
      const editedMsg = messages.find((m: Message) => m.id === editingMessageId);
      if (editedMsg) {
        parentMessageId = editedMsg.parentId ?? undefined;
      }
      abortCurrentRequest();
      setEditingMessageId(null);
    } else if (!isLegacyConversation) {
      // Normal submit: chain from the last displayed message for established sessions only.
      // Draft stream slots (new chat / new parallel session) stay on a fresh server session until
      // the first turn completes — omit parentMessageId here so turns are not linked as tree
      // siblings/branches of another session. Regenerate and edit still pass parent explicitly.
      const lastDisplayed = displayMessages[displayMessages.length - 1];
      if (lastDisplayed && !usesDraftStreamKeyRef.current) {
        parentMessageId = lastDisplayed.id;
      }
    }

    setInputValue('');
    setAttachments([]);
    setSelectedActivities([]);
    setBrowserContext(null); // Clear browser context after submit
    // Note: Don't clear selection infos - they persist for follow-up questions

    // Set the channel ID for this conversation if not already set
    // This ensures the conversation is saved to the correct channel even if user switches channels
    // For KB context (channelId is null), use kbCollectionId for storage
    if (!conversationChannelId) {
      if (channelId) {
        setConversationChannelId(channelId);
      } else if (kbCollectionIdProp) {
        setConversationChannelId(kbCollectionIdProp);
      }
    }

    // Scroll immediately after clearing input, before query is submitted
    setTimeout(() => {
      scrollToBottom();
    }, 50);

    // Include userTags in the user message for display
    const userTagsForMessage =
      Object.keys(currentUserTags).length > 0 ? currentUserTags : undefined;

    await submitQuery(
      query,
      messageAttachments,
      selectionContexts,
      displayContent,
      userTagsForMessage,
      parentMessageId,
    );
  }, [
    inputValue,
    attachments,
    selectedActivities,
    activeSelectionInfos,
    browserContext,
    currentUserTags,
    submitQuery,
    scrollToBottom,
    conversationChannelId,
    channelId,
    editingMessageId,
    messages,
    displayMessages,
    abortCurrentRequest,
    isLegacyConversation,
    kbCollectionIdProp,
  ]);

  // Submits once the auto-send seed effect above has landed in inputValue (handleSubmit closes over it).
  useEffect(() => {
    if (
      autoSendPendingQueryRef.current !== null &&
      inputValue === autoSendPendingQueryRef.current
    ) {
      autoSendPendingQueryRef.current = null;
      void handleSubmit();
    }
  }, [inputValue, handleSubmit]);

  const hasBackgroundStreamingElsewhere = useMemo(() => {
    if (streamingSessionIds.length === 0) return false;
    if (messages.some((m: Message) => m.isStreaming)) return false;
    const curKeys = new Set([conversationId, streamThreadKey].filter(k => k.trim().length > 0));
    return streamingSessionIds.some(id => id && !curKeys.has(id));
  }, [streamingSessionIds, conversationId, streamThreadKey, messages]);

  // Shared props for XyneAIInputSection
  const contextSelections: ContextSelections = {
    channels: selectedChannels,
    tickets: selectedTickets,
    canvases: selectedCanvases,
    transcripts: selectedTranscripts,
    recordings: selectedRecordings,
  };

  const sharedInputSectionProps = {
    // Model picker. Empty list (agent has no litellm credential) ⇒ the picker
    // hides itself, so no extra gating is needed here beyond the v2 check.
    models: isV2 ? (agentModelsData?.models ?? []) : [],
    defaultModel: agentModelsData?.defaultModel ?? null,
    selectedModel,
    onSelectModel: setSelectedModel,
    thinkingLevel,
    onSelectThinking: setThinkingLevel,
    showContextModal,
    onCloseContextModal: handleCloseContextModal,
    onConfirmContext: handleConfirmContext,
    contextSelections,
    channelId,
    channelName,
    channelDescription,
    scopeType,
    threadInfo: activeThreadInfo,
    canvasInfo,
    selectionInfos: activeSelectionInfos,
    inputValue,
    onInputChange: setInputValue,
    onSubmit: () => void handleSubmit(),
    onThreadInfoChange: setActiveThreadInfo,
    onSelectionInfosChange: setActiveSelectionInfos,
    onAttachmentsChange: setAttachments,
    onBrowserContextChange: setBrowserContext,
    selectedChannels,
    onRemoveChannel: handleRemoveChannel,
    onAddChannel: handleAddChannel,
    nonDMChannels,
    collectionsList: effectiveCollectionsList,
    // Only pass grants when the agent is COLLECTIONS-scoped — USER scope
    // and v1 (no agent) should keep the legacy "no drill-down gating"
    // behavior, which the input box achieves when this prop is absent.
    ...(selectedAgent && selectedAgent.kbScope === 'COLLECTIONS'
      ? { agentKbGrants: selectedAgent.collections }
      : {}),
    fileScopes,
    onFileScopesChange: setFileScopes,
    folderScopes,
    onFolderScopesChange: setFolderScopes,
    onOpenContextModal: handleOpenContextModal,
    selectedTickets,
    onRemoveTicket: handleRemoveTicket,
    selectedCanvases,
    onRemoveCanvas: handleRemoveCanvas,
    selectedTranscripts,
    onRemoveTranscript: handleRemoveTranscript,
    selectedRecordings,
    onRemoveRecording: handleRemoveRecording,
    selectedActivities,
    onActivitiesChange: setSelectedActivities,
    onAbort: () => {
      abortCurrentRequest();
    },
    webSearchEnabled,
    webSearchAccessible,
    onWebSearchToggle: () => setWebSearchEnabled(!webSearchEnabled),
    deepResearchEnabled,
    deepResearchAccessible,
    onDeepResearchToggle: () => setDeepResearchEnabled(!deepResearchEnabled),
    createCanvasEnabled,
    onCreateCanvasToggle: () => setCreateCanvasEnabled(!createCanvasEnabled),
    onUserTagsChange: setCurrentUserTags,
  };

  const showInlineDebugger = showDebugger && isV2 && debuggerPresentation === 'split';
  const showReplacingDebugger = showDebugger && isV2 && debuggerPresentation === 'replace';
  const isCompactSidebar = sidebarContentWidth > 0 && sidebarContentWidth < 760;
  const isTightSidebar = sidebarContentWidth > 0 && sidebarContentWidth < 640;

  useEffect(() => {
    const el = sidebarContentRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const updateWidth = (): void => {
      setSidebarContentWidth(el.clientWidth);
    };

    updateWidth();
    const observer = new ResizeObserver(() => updateWidth());
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      setSidebarContentWidth(sidebarContentRef.current?.clientWidth ?? 0);
    });
    return () => cancelAnimationFrame(rafId);
  }, [showInlineDebugger]);

  return (
    <div
      className={cn(
        'grid h-full min-h-0 w-full overflow-hidden',
        isMobile && 'border bg-background',
        isFullscreen
          ? isMobile
            ? 'min-h-full pb-[calc(6rem+env(safe-area-inset-bottom))]'
            : 'h-full'
          : isMobile
            ? 'h-[95vh] pb-4'
            : 'h-full rounded-2xl',
      )}
      style={{
        gridTemplateColumns: showInlineDebugger
          ? `minmax(0, 1fr) 8px ${debuggerWidth}px`
          : 'minmax(0, 1fr)',
      }}
    >
      <div
        ref={dragAndDropAreaRef}
        className={cn(
          'relative flex min-h-0 min-w-0 flex-1 flex-col',
          isMobile && 'bg-background',
          showInlineDebugger && 'border-r border-border/70',
          showReplacingDebugger && 'hidden',
        )}
      >
        {/* Drag and Drop Overlay */}
        {isDragging && (
          <div className='absolute inset-0 z-50 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-primary/50 bg-background/95 backdrop-blur-sm'>
            <div className='flex flex-col items-center gap-3'>
              <div className='rounded-full bg-primary/10 p-4'>
                <Upload className='h-8 w-8 text-primary' />
              </div>
              <div className='text-center'>
                <p className='text-lg font-medium text-foreground'>Drop files to attach</p>
                <p className='text-sm text-muted-foreground'>
                  Images, PDF, text, office documents, or data files
                </p>
              </div>
            </div>
          </div>
        )}
        {showHistorySidebar ? (
          <ConversationHistory
            onClose={() => xyneAIActor.send({ type: 'CLOSE' })}
            conversations={conversations}
            conversationId={conversationId}
            loadingSessionId={loadingHistorySessionId}
            streamingSessionIds={streamingSessionIds}
            onBack={() => setShowHistorySidebar(false)}
            onLoadConversation={(conversation): void => {
              void handleLoadConversation(conversation);
            }}
            onDeleteConversation={handleDeleteConversation}
            selectedAgentSlug={effectiveAgentSlug}
            agents={isV2 ? accessibleAgents : []}
            {...(isV2 && !isAgentForced ? { onSelectAgent: handleSelectAgentFromHistory } : {})}
          />
        ) : showUserActivityPanel ? (
          <UserActivityPanel
            isOpen={showUserActivityPanel}
            onClose={() => setShowUserActivityPanel(false)}
            onAddToChat={handleAddActivities}
          />
        ) : (
          <div ref={sidebarContentRef} className='flex h-full min-h-0 flex-col'>
            {aiOnboarding.isActive ? (
              <XyneAIOnboardingHeader onClose={completeOnboarding} />
            ) : isFullscreen && messages.length === 0 ? null : (
              <XyneAIHeader
                onNewChat={handleNewChat}
                onShowHistory={() => setShowHistorySidebar(true)}
                onShowUserActivity={() => setShowUserActivityPanel(true)}
                isMobile={isMobile}
                isCompact={isCompactSidebar}
                isTight={isTightSidebar}
                title={isFullscreen ? 'Xyne AI' : selectedAgentName || 'Ask AI'}
                selectedAgent={selectedAgent}
                hideClose={hideHeaderClose}
                dense={denseHeader}
                onShowDebugger={
                  isV2 && !isAgentForced
                    ? () => {
                        setDebugTurnIndex(null);
                        setDebugSessionId(null);
                        setDebugFocusToolCallId(null);
                        setShowDebugger(true);
                      }
                    : undefined
                }
                {...(isFullscreen
                  ? {
                      hideMemoriesAndActivity: true,
                      hideTitle: true,
                      hideHistory: true,
                    }
                  : {})}
                {...(isAgentForced ? { hideTitle: true } : {})}
                {...(onClose !== undefined
                  ? {
                      onClose: () => {
                        if (!preserveStreamingOnClose) abortCurrentRequest();
                        onClose();
                      },
                    }
                  : {})}
              />
            )}

            {hasBackgroundStreamingElsewhere ? (
              <div className='flex-shrink-0 border-b border-border bg-muted/35 px-3 py-2 text-xs text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1'>
                <span>Another chat is still generating.</span>
                <button
                  type='button'
                  onClick={() => {
                    const s = xyneAIStreamManager.findLatestSidebarStream();
                    const sid = s?.sessionId || s?.streamSlotKey;
                    if (!sid) return;
                    // Switch to the responding stream's agent first so the
                    // selector reflects it and the loaded session is scoped to
                    // the right agent (not the one currently selected).
                    const respondingAgent = s?.agentSlug ?? null;
                    if (isV2 && respondingAgent !== selectedAgentSlug) {
                      setSelectedAgentSlug(respondingAgent);
                    }
                    xyneAIActor.send({ type: 'SET_FOCUS_SESSION', sessionId: sid });
                  }}
                  className='font-medium text-primary hover:underline'
                  data-track-category='AskAI'
                  data-track-name='GoToRespondingChat'
                >
                  Go to responding chat
                </button>
                <span className='text-muted-foreground/50'>·</span>
                <button
                  type='button'
                  onClick={() => {
                    const keep = [conversationId, streamThreadKey].filter(
                      k => k && k.trim().length > 0,
                    );
                    xyneAIStreamManager.abortAllExcept(keep);
                    setStreamingSessionIds(xyneAIStreamManager.getStreamingSessionIds());
                  }}
                  className='font-medium text-destructive hover:underline'
                  data-track-category='AskAI'
                  data-track-name='AbortOtherChats'
                >
                  Abort others
                </button>
              </div>
            ) : null}

            <div className='min-h-0 flex-1 overflow-hidden'>
              <div className='flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden'>
                {isLoadingConversation ? (
                  <div className='px-3 py-4'>
                    <div className='space-y-4'>
                      <div className='flex justify-end'>
                        <div className='h-12 w-3/4 animate-pulse rounded-xl bg-muted' />
                      </div>
                      <div className='flex justify-start'>
                        <div className='w-full space-y-2'>
                          <div className='h-4 animate-pulse rounded bg-muted' />
                          <div className='h-4 w-5/6 animate-pulse rounded bg-muted' />
                          <div className='h-4 w-4/6 animate-pulse rounded bg-muted' />
                        </div>
                      </div>
                    </div>
                  </div>
                ) : messages.length === 0 ? (
                  isFullscreen ? (
                    <AILandingHeroErrorBoundary>
                      <AILandingHero
                        renderInput={
                          <XyneAIInputSection
                            ref={xyneAIInputRef}
                            isOnboarding={false}
                            showChannelTag={false}
                            isStreaming={false}
                            contextPanelPosition='top'
                            selectedAgentSlug={effectiveAgentSlug}
                            agents={isV2 ? accessibleAgents : []}
                            {...(isV2 && !isAgentForced
                              ? { onSelectAgent: handleSelectAgent }
                              : {})}
                            {...sharedInputSectionProps}
                          />
                        }
                      />
                    </AILandingHeroErrorBoundary>
                  ) : aiOnboarding.isActive ? (
                    <div className='flex h-full flex-col px-3 py-6'>
                      <div className='flex items-start gap-2'>
                        <div className='mt-0.5 flex-shrink-0'>
                          <XyneAIStar size={18} />
                        </div>
                        <p className='text-sm leading-relaxed text-foreground'>
                          Hi! I&apos;m your AI assistant. I can help you learn about everything Xyne
                          Spaces has to offer. Try asking me one of the questions below, or ask
                          anything you&apos;d like!
                        </p>
                      </div>
                      <div className='mt-6 flex flex-wrap gap-2'>
                        {visibleSuggestions.map(suggestion => (
                          <button
                            key={suggestion}
                            onClick={() => handleSuggestionClick(suggestion)}
                            className='rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium leading-5 text-muted-foreground transition-colors hover:bg-accent'
                            data-track-category='AIOnboarding'
                            data-track-name='SuggestionChip'
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <XyneAIEmptyState />
                  )
                ) : (
                  <div className={cn(isFullscreen ? 'flex justify-center' : '')}>
                    <div
                      className={cn(
                        'py-4',
                        aiOnboarding.isActive && 'bot-markdown-content',
                        isFullscreen ? 'w-full max-w-2xl px-4' : 'px-3',
                      )}
                    >
                      <div className='max-w-full space-y-4'>
                        {aiOnboarding.isActive && (
                          <div className='mb-2 flex items-start gap-2'>
                            <div className='mt-0.5 flex-shrink-0'>
                              <XyneAIStar size={18} />
                            </div>
                            <p className='text-sm leading-relaxed text-foreground'>
                              Hi! I&apos;m your AI assistant. I can help you learn about everything
                              Xyne Spaces has to offer. Try asking me one of the questions below, or
                              ask anything you&apos;d like!
                            </p>
                          </div>
                        )}
                        <ConversationToolInvocationsContext.Provider
                          value={conversationToolInvocations}
                        >
                          {(() => {
                            // lastBotIndex / lastUserIndex / siblingIndexById are
                            // computed in the memo above; just consume here so this
                            // IIFE doesn't re-walk both lists on every render.
                            return displayMessages.map((message: Message, index: number) => {
                              const isLatestBotMessage =
                                message.type === 'bot' && index === lastBotIndex;
                              const isLatestUserMessage =
                                message.type === 'user' && index === lastUserIndex;
                              const siblingCount = siblingCountById.get(message.id) ?? 0;
                              const siblingIndex = siblingIndexById.get(message.id) ?? 0;
                              const hasBranches = siblingCount > 1;
                              const botTurnIndex =
                                message.type === 'bot'
                                  ? displayMessages
                                      .slice(0, index + 1)
                                      .filter(item => item.type === 'bot').length - 1
                                  : -1;
                              const showFollowUps =
                                isV2 &&
                                isLatestBotMessage &&
                                !message.isStreaming &&
                                !!message.followUpSuggestions?.length;
                              return (
                                <MessageItem
                                  // Stable key so the bubble doesn't remount when
                                  // the id swaps temp→server at completion (which
                                  // would kill the activity block's transition).
                                  key={message.stableKey ?? message.id}
                                  message={message}
                                  onFeedback={(id, type) => void handleFeedback(id, type)}
                                  onCitationClick={handleCitationClick}
                                  onSummarizerCitationClick={handleSummarizerCitationClick}
                                  feedbackValue={feedbackMap[message.id] || null}
                                  isV2={isV2}
                                  onRatingChange={handleRatingChange}
                                  onRegenerate={
                                    !isLegacyConversation && isLatestBotMessage
                                      ? () => void handleRegenerate()
                                      : undefined
                                  }
                                  onEditSubmit={
                                    !isLegacyConversation && isLatestUserMessage
                                      ? (newContent: string) =>
                                          void handleEditMessage(message.id, newContent)
                                      : undefined
                                  }
                                  onEditMobile={
                                    !isLegacyConversation && isLatestUserMessage && isMobile
                                      ? () => handleEditMobile(message.id)
                                      : undefined
                                  }
                                  isLatestBotMessage={isLatestBotMessage}
                                  branchInfo={
                                    !isLegacyConversation && hasBranches
                                      ? { index: siblingIndex, total: siblingCount }
                                      : undefined
                                  }
                                  onBranchNavigate={
                                    !isLegacyConversation && hasBranches
                                      ? (dir: 'prev' | 'next') =>
                                          handleBranchNavigate(message.id, dir)
                                      : undefined
                                  }
                                  onDebug={
                                    isV2 && message.type === 'bot'
                                      ? () => {
                                          setDebugTurnIndex(botTurnIndex);
                                          // Prefer sessionId pinning when the
                                          // run is known. Falls back to null
                                          // (turn-index path) for live streams
                                          // whose AgentRun hasn't been linked
                                          // to chatMessageId yet.
                                          setDebugSessionId(message.debugSessionId ?? null);
                                          setDebugFocusToolCallId(null);
                                          setShowDebugger(true);
                                        }
                                      : undefined
                                  }
                                  onOpenToolDebug={
                                    isV2 && message.type === 'bot'
                                      ? (toolCallId: string) => {
                                          setDebugTurnIndex(botTurnIndex);
                                          setDebugSessionId(message.debugSessionId ?? null);
                                          setDebugFocusToolCallId(toolCallId);
                                          setShowDebugger(true);
                                        }
                                      : undefined
                                  }
                                  onFollowUpSuggestionClick={
                                    showFollowUps ? handleSuggestionClick : undefined
                                  }
                                />
                              );
                            });
                          })()}
                        </ConversationToolInvocationsContext.Provider>
                        {aiOnboarding.isActive && visibleSuggestions.length > 0 && (
                          <div className='mt-4 flex flex-wrap gap-2'>
                            {visibleSuggestions.map(suggestion => (
                              <button
                                key={suggestion}
                                onClick={() => handleSuggestionClick(suggestion)}
                                className='rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium leading-5 text-muted-foreground transition-colors hover:bg-accent'
                                data-track-category='AIOnboarding'
                                data-track-name='SuggestionChip'
                              >
                                {suggestion}
                              </button>
                            ))}
                          </div>
                        )}
                        {aiOnboarding.isActive && visibleSuggestions.length === 0 && (
                          <p className='mt-4 text-sm text-muted-foreground'>
                            You can also ask me anything else!
                          </p>
                        )}
                        <div ref={messagesEndRef} />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {aiOnboarding.isActive && onboardingAnsweredCount >= 3 && (
              <div className='px-3 py-2'>
                <button
                  onClick={completeOnboarding}
                  className='w-full rounded-xl bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90'
                  data-track-category='AIOnboarding'
                  data-track-name='DoneExploring'
                >
                  Done exploring — open my workspace
                </button>
              </div>
            )}

            {/* composer-container — owns the gutter around the composer */}
            {!(isFullscreen && messages.length === 0) && (
              <div
                className={cn(
                  isFullscreen ? 'flex justify-center px-4 pb-6' : 'px-3',
                  !isFullscreen && !isMobile && 'pb-3',
                )}
              >
                <div className={cn(isFullscreen && 'w-full max-w-2xl')}>
                  <XyneAIInputSection
                    ref={xyneAIInputRef}
                    isOnboarding={aiOnboarding.isActive}
                    showChannelTag={true}
                    isStreaming={isActiveSessionStreaming}
                    contextPanelPosition='bottom'
                    selectedAgentSlug={effectiveAgentSlug}
                    agents={isV2 ? accessibleAgents : []}
                    {...(isV2 && !isAgentForced ? { onSelectAgent: handleSelectAgent } : {})}
                    compactToolbar={isCompactSidebar}
                    {...sharedInputSectionProps}
                    kbCollectionId={kbCollectionIdProp}
                    kbOpenNonce={kbOpenNonce}
                    onSelectedCollectionsChange={setSelectedCollectionIds}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showReplacingDebugger && (
        <AskAIDebugPanel
          open
          fill
          conversationId={conversationId || streamThreadKey}
          agentSlug={effectiveAgentSlug || 'ask-ai'}
          liveEvents={debugEvents}
          running={isActiveSessionStreaming}
          artifactsReadyVersion={debugArtifactsReadyVersion}
          selectedTurnIndex={debugTurnIndex}
          selectedTurnLive={debugTurnIndex !== null && debugTurnIndex === streamingBotTurnIndex}
          selectedSessionId={debugSessionId}
          focusToolCallId={debugFocusToolCallId}
          onClose={() => setShowDebugger(false)}
        />
      )}

      {showInlineDebugger && (
        <>
          <button
            type='button'
            aria-label='Resize debugger panel'
            className='group relative z-10 w-2 shrink-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40'
            onMouseDown={handleDebuggerResizeStart}
            data-track-category='XyneAI'
            data-track-name='DEBUG_PANEL_RESIZE'
          >
            <span className='absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 group-hover:bg-primary/60' />
          </button>
          <AskAIDebugPanel
            open={showDebugger && isV2}
            inline
            width={debuggerWidth}
            conversationId={conversationId || streamThreadKey}
            agentSlug={effectiveAgentSlug || 'ask-ai'}
            liveEvents={debugEvents}
            running={isActiveSessionStreaming}
            artifactsReadyVersion={debugArtifactsReadyVersion}
            selectedTurnIndex={debugTurnIndex}
            selectedTurnLive={debugTurnIndex !== null && debugTurnIndex === streamingBotTurnIndex}
            selectedSessionId={debugSessionId}
            focusToolCallId={debugFocusToolCallId}
            onClose={() => setShowDebugger(false)}
          />
        </>
      )}
    </div>
  );
};

export default XyneAISidebar;
