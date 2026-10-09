import { aiSendButtonTrackingMetadata } from '../../../../services/Analytics/xyneAiTracking';
import { logger, Event as LogEvent } from '../../../../utils/logger';
import React, { type ReactElement } from 'react';
import {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback,
  forwardRef,
  useImperativeHandle,
} from 'react';
import { Automation, ChatDefault, File02Text, FileText, Globe } from '@xyne/icons';
import { Activity } from 'lucide-react';
import { toast } from 'sonner';
import { commandsForSurface } from '@xyne/shared/commands';
import Avatar from '../../../ui/Avatar/Avatar';
import { RecordingTranscriptModal } from './RecordingTranscriptModal';
import type { ClawAgentModel } from '../../../../services/clawAgentModelsService';
import type { AccessibleClawAgent } from '../../../../services/clawAgentListService';
import { usePlatform } from '../../../../hooks/usePlatform';
import { rememberNoAgentChoice } from '../../../../hooks/useSelectedAgent';
import type { CollectionSummary } from '../../../../services/Knowledge/collectionService';
import type {
  ThreadInfo,
  CanvasInfo,
  SelectionInfo,
  WorkflowInfo,
} from '../../../../machines/xyneAIMachine';
import { useNavigate } from 'react-router-dom';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { DANGEROUS_EXTENSIONS } from '@xyne/shared';
import type { UserActivity } from '../../../../hooks/useUserActivity';
import type { UserTag } from '../utils/XyneAITypes';
import type {
  SelectedChannel,
  SelectedTicket,
  SelectedCanvas,
  SelectedTranscript,
  SelectedRecording,
  SelectedMessage,
  SelectedPerson,
  SelectedSharedFile,
  SelectedApp,
  ContextSelections,
} from './ContextPickerPanel';
import { Composer } from '../../../Composer/Composer';
import type {
  ComposerHandle,
  ComposerTrayItem,
  ContextRef,
  KnowledgeSelection,
  PickedContext,
  ThinkingLevel,
} from '../../../Composer/Composer.types';
import { addPicked, pickedRefsOf, removePicked } from '../../../Composer/Composer.utils';
import { knowledgeTrayItems, selectionTrayItems } from '../../../Composer/ComposerControls';

// Browser context interface
export interface BrowserContext {
  type: 'browser';
  text: string;
  url: string;
  domain: string;
  title: string;
  timestamp: number;
}

// Module-level stable empty arrays. Used as destructure defaults below so
// callers that omit these optional list props don't get a freshly allocated
// `[]` each render — that would change the prop's identity every render
// and cause useEffect deps like `[selectionInfos]` to fire on every render,
// blowing up downstream consumers with infinite setState→render loops.
const EMPTY_SELECTION_INFOS: SelectionInfo[] = [];
const EMPTY_CHANNELS: SelectedChannel[] = [];
const EMPTY_TICKETS: SelectedTicket[] = [];
const EMPTY_CANVASES: SelectedCanvas[] = [];
const EMPTY_TRANSCRIPTS: SelectedTranscript[] = [];
const EMPTY_RECORDINGS: SelectedRecording[] = [];
const EMPTY_MESSAGES: SelectedMessage[] = [];
const EMPTY_PEOPLE: SelectedPerson[] = [];
const EMPTY_SHARED_FILES: SelectedSharedFile[] = [];
const EMPTY_APPS: SelectedApp[] = [];
const EMPTY_ACTIVITIES: UserActivity[] = [];
const EMPTY_SCOPES: { id: string; name: string }[] = [];

// File attachment limits — kept in sync with claw-auth's run-stream
// rehydration caps (xyne-claw-auth/backend/src/routes/run-stream.ts).
// Without alignment, a user can attach a 50 MB file in turn 1 and have
// it silently dropped from the agent's context in turn 2 when claw-auth
// refuses to rehydrate it.
const MAX_INDIVIDUAL_FILE_SIZE = 10 * 1024 * 1024; // 10 MiB
const MAX_TOTAL_SIZE = 25 * 1024 * 1024; // 25 MiB
const MAX_FILE_COUNT = 20;

// Blocked file extensions (security blocklist approach — all types allowed except dangerous ones)
const blockedExtensions = new Set(DANGEROUS_EXTENSIONS.map(ext => ext.toLowerCase()));

const isValidBase64 = (str: string): boolean => {
  if (!str || str.length === 0) return false;
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(str)) return false;
  return str.length % 4 === 0;
};

export interface XyneAIInputBoxProps {
  channelId?: string | null;
  threadInfo?: ThreadInfo | null | undefined;
  canvasInfo?: CanvasInfo | null | undefined;
  workflowInfo?: WorkflowInfo | null | undefined;
  onRemoveWorkflowInfo?: ((e: React.MouseEvent) => void) | undefined;
  selectionInfos?: SelectionInfo[];
  inputValue: string;
  onInputChange: (value: string) => void;
  /** `trigger` says which affordance sent it; the button has its own click row. */
  onSubmit: (trigger?: 'button' | 'enter') => void;
  onEnterVoiceMode?: () => void;
  onSelectedCollectionsChange?: (collectionIds: string[]) => void;
  onThreadInfoChange?: (threadInfo: ThreadInfo | null) => void;
  onSelectionInfosChange?: (selectionInfos: SelectionInfo[]) => void;
  onAttachmentsChange?: (attachments: Attachment[]) => void;
  onBrowserContextChange?: (context: BrowserContext | null) => void;
  /**
   * Replaces the attached context wholesale — picks and removals build the
   * next ContextSelections from the current props and push it up.
   */
  onContextSelectionsChange?: (selections: ContextSelections) => void;
  selectedChannels?: SelectedChannel[];
  selectedTickets?: SelectedTicket[];
  selectedCanvases?: SelectedCanvas[];
  selectedTranscripts?: SelectedTranscript[];
  selectedRecordings?: SelectedRecording[];
  selectedMessages?: SelectedMessage[];
  selectedPeople?: SelectedPerson[];
  selectedSharedFiles?: SelectedSharedFile[];
  selectedApps?: SelectedApp[];
  selectedActivities?: UserActivity[];
  onActivitiesChange?: (activities: UserActivity[]) => void;
  isStreaming?: boolean;
  onAbort?: () => void;
  webSearchEnabled?: boolean;
  webSearchAccessible?: boolean;
  onWebSearchToggle?: () => void;
  deepResearchEnabled?: boolean;
  deepResearchAccessible?: boolean;
  onDeepResearchToggle?: () => void;
  createCanvasEnabled?: boolean;
  onCreateCanvasToggle?: () => void;
  onUserTagsChange?: (userTags: Record<string, UserTag>) => void;
  isOnboarding?: boolean;
  selectedAgentSlug?: string | null;
  agents?: AccessibleClawAgent[];
  onSelectAgent?: (slug: string | null) => void;
  isAuto?: boolean;
  onSelectAuto?: () => void;
  /** Models the selected agent can run. */
  models?: ClawAgentModel[];
  /** The list is still loading for the agent just picked. */
  modelsLoading?: boolean;
  /** The agent's configured model — what Auto runs. */
  defaultModel?: string | null;
  defaultModelName?: string | null;
  /** Per-message thinking level for the model menu. */
  thinkingLevel?: ThinkingLevel | null;
  onSelectThinking?: (v: ThinkingLevel | null) => void;
  /** Currently pinned model, or null for Auto (the agent's default). */
  selectedModel?: string | null;
  onSelectModel?: (model: string | null) => void;
  kbCollectionId?: string | undefined;
  // Bumped by xyneAIMachine on every OPEN with a kbCollectionId. When this
  // changes, the auto-add effect re-attaches the KB collection chip even if
  // the user previously removed it (e.g. clicking Ask AI again from /knowledge-base).
  kbOpenNonce?: number | undefined;
  collectionsList?: CollectionSummary[];
  /** Bumped after each send: the collections the user picked go with that
   *  message, the one the sidebar was opened on stays. */
  sentNonce?: number;
  /** When Ask AI is opened from a file viewer / picker, scopes retrieval to these files (multi-select). */
  fileScopes?: { id: string; name: string }[];
  /** Replace the selected file set (id = each file's Vespa docId / fileId UUID). */
  onFileScopesChange?: (fileScopes: { id: string; name: string }[]) => void;
  /** Folders scoped in from the collection picker. Sent to claw-auth as a
   *  single 'folder' attached_context pointer per id — claw-auth resolves it
   *  itself, at Vespa-query time. */
  folderScopes?: { id: string; name: string }[];
  onFolderScopesChange?: (folderScopes: { id: string; name: string }[]) => void;
}

// Interface for the XyneAIInputBox imperative API (matches InputBoxHandle pattern)
export interface XyneAIInputBoxHandle {
  addFiles: (files: File[]) => void;
  clearContent: () => void;
  insertContent: (content: string) => void;
  isSuggestionOpen: () => boolean;
  kbCollectionId?: string;
  focus: () => void;
}

export interface Attachment {
  id: string;
  name: string;
  size: number;
  type: string;
  file: File;
  data: string; // base64 encoded data
  mimeType: string;
  filename: string;
}

/**
 * The Ask AI sidebar's composer: the shared {@link Composer} (the same one the
 * AI screen uses) plus what only the sidebar has — the thread, canvas, browser
 * and workflow it was opened from, the Knowledge Base collection it was opened
 * on, and the per-agent KB drill-down.
 */
export const XyneAIInputBox = forwardRef<XyneAIInputBoxHandle, XyneAIInputBoxProps>(
  (
    {
      channelId,
      threadInfo,
      canvasInfo,
      workflowInfo,
      onRemoveWorkflowInfo,
      selectionInfos = EMPTY_SELECTION_INFOS,
      inputValue,
      onInputChange,
      onSubmit,
      onEnterVoiceMode,
      onSelectedCollectionsChange,
      onThreadInfoChange,
      onSelectionInfosChange,
      onAttachmentsChange,
      onBrowserContextChange,
      onContextSelectionsChange,
      selectedChannels = EMPTY_CHANNELS,
      selectedTickets = EMPTY_TICKETS,
      selectedCanvases = EMPTY_CANVASES,
      selectedTranscripts = EMPTY_TRANSCRIPTS,
      selectedRecordings = EMPTY_RECORDINGS,
      selectedMessages = EMPTY_MESSAGES,
      selectedPeople = EMPTY_PEOPLE,
      selectedSharedFiles = EMPTY_SHARED_FILES,
      selectedApps = EMPTY_APPS,
      selectedActivities = EMPTY_ACTIVITIES,
      onActivitiesChange,
      isStreaming = false,
      onAbort,
      webSearchEnabled = false,
      webSearchAccessible = false,
      onWebSearchToggle,
      deepResearchEnabled = false,
      deepResearchAccessible = false,
      onDeepResearchToggle,
      createCanvasEnabled = false,
      onCreateCanvasToggle,
      kbCollectionId = '',
      kbOpenNonce,
      fileScopes = EMPTY_SCOPES,
      onFileScopesChange,
      folderScopes = EMPTY_SCOPES,
      onFolderScopesChange,
      onUserTagsChange,
      isOnboarding = false,
      selectedAgentSlug = null,
      agents = [],
      onSelectAgent,
      isAuto = false,
      onSelectAuto,
      models = [],
      modelsLoading = false,
      defaultModel = null,
      defaultModelName = null,
      selectedModel = null,
      onSelectModel,
      thinkingLevel = null,
      onSelectThinking,
      collectionsList: collectionsListProp = [],
      sentNonce = 0,
    },
    ref,
  ): ReactElement => {
    const composerRef = useRef<ComposerHandle>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const { isMobile } = usePlatform();
    const navigate = useNavigate();
    const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>([]);

    // Collection state
    const [selectedCollections, setSelectedCollections] = useState<{ id: string; name: string }[]>(
      [],
    );
    const collectionsList = collectionsListProp;

    // Track if auto-added collection was manually removed
    const autoAddedCollectionRemoved = useRef(false);

    // Auto-add collection from KB context when collections are loaded
    // Auto-add collection from KB when opened from Knowledge Base
    useEffect(() => {
      if (!kbCollectionId) {
        return;
      }

      // Don't re-add if user manually removed the auto-added collection
      if (autoAddedCollectionRemoved.current) {
        return;
      }

      // Find collection from already loaded collectionsList
      const collection = collectionsList.find(c => c.id === kbCollectionId);

      if (collection && selectedCollections.length === 0) {
        const newCollection = [{ id: collection.id, name: collection.name }];
        setSelectedCollections(newCollection);
        // Notify parent so it's sent to backend
        onSelectedCollectionsChange?.(newCollection.map(c => c.id));
      }
    }, [kbCollectionId, collectionsList, selectedCollections.length, onSelectedCollectionsChange]);

    // Re-attach the KB collection chip each time the user clicks the Ask AI
    // button from /knowledge-base. xyneAIMachine bumps kbOpenNonce on every
    // OPEN with a kbCollectionId; that bump signals "treat this as a fresh
    // scope intent", so we clear the manual-removal flag and force-re-add the
    // collection (overriding the prior chip set so the latest kbCollectionId
    // wins if the user opens AI from a different collection mid-session).
    const lastSeenOpenNonce = useRef<number | undefined>(kbOpenNonce);
    useEffect(() => {
      if (kbOpenNonce === undefined) return;
      if (kbOpenNonce === lastSeenOpenNonce.current) return;
      if (!kbCollectionId) {
        lastSeenOpenNonce.current = kbOpenNonce;
        return;
      }
      // collectionsList (Zero query) can still be hydrating on a fresh
      // sidebar mount — don't mark this nonce as handled until the
      // collection is actually found, so this effect retries on the next
      // collectionsList update instead of silently dropping the chip.
      const collection = collectionsList.find(c => c.id === kbCollectionId);
      if (!collection) return;
      lastSeenOpenNonce.current = kbOpenNonce;
      autoAddedCollectionRemoved.current = false;
      const newCollection = [{ id: collection.id, name: collection.name }];
      setSelectedCollections(newCollection);
      onSelectedCollectionsChange?.(newCollection.map(c => c.id));
    }, [kbOpenNonce, kbCollectionId, collectionsList, onSelectedCollectionsChange]);

    // After a send, keep only the collection Ask AI was opened on (if it is
    // still attached); the ones picked here went out with that message.
    const lastSentNonceRef = useRef(sentNonce);
    useEffect(() => {
      if (sentNonce === lastSentNonceRef.current) return;
      lastSentNonceRef.current = sentNonce;
      setSelectedCollections(prev => {
        const kept = prev.filter(c => c.id === kbCollectionId);
        if (kept.length !== prev.length) onSelectedCollectionsChange?.(kept.map(c => c.id));
        return kept;
      });
    }, [sentNonce, kbCollectionId, onSelectedCollectionsChange]);

    // The "+" menu's Collections picker. Picking is an explicit override of
    // the KB auto-add, so the auto-add stays off afterwards: open Ask AI from
    // /knowledge-base (auto-adds A) → pick B → remove B, and A must not snap
    // back. The Ask AI button still re-attaches A via kbOpenNonce.
    const handleKnowledgeChange = (next: KnowledgeSelection): void => {
      autoAddedCollectionRemoved.current = true;
      setSelectedCollections(next.collections);
      onSelectedCollectionsChange?.(next.collections.map(c => c.id));
      onFolderScopesChange?.(next.folders);
      onFileScopesChange?.(next.files);
    };

    // Thread info state - track if user has removed it
    const [activeThreadInfo, setActiveThreadInfo] = useState<ThreadInfo | null>(threadInfo ?? null);

    // Canvas info state - track if user has removed it
    const [activeCanvasInfo, setActiveCanvasInfo] = useState<CanvasInfo | null>(canvasInfo ?? null);

    // Selection infos state (multiple selections)
    const [activeSelectionInfos, setActiveSelectionInfos] = useState<SelectionInfo[]>(
      selectionInfos ?? [],
    );

    // Browser context state
    const [browserContext, setBrowserContext] = useState<BrowserContext | null>(null);
    // Recording pill → its transcript, read in place over the composer.
    const [transcriptCallId, setTranscriptCallId] = useState<string | null>(null);

    // Update activeThreadInfo when threadInfo prop changes
    useEffect(() => {
      setActiveThreadInfo(threadInfo ?? null);
    }, [threadInfo]);

    // Update activeCanvasInfo when canvasInfo prop changes
    useEffect(() => {
      setActiveCanvasInfo(canvasInfo ?? null);
    }, [canvasInfo]);

    // Update activeSelectionInfos when selectionInfos prop changes
    useEffect(() => {
      setActiveSelectionInfos(selectionInfos ?? []);
    }, [selectionInfos]);

    // Listen for browser context from webview
    useEffect(() => {
      const handleBrowserContext = (event: CustomEvent<BrowserContext>) => {
        const context = event.detail;

        // Validate context data for security
        if (!context || typeof context !== 'object') {
          logger.warn(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_warn',
            message: String('[XyneAI] Invalid browser context received'),
          });
          return;
        }

        // Sanitize text - limit length and remove potentially dangerous content
        const sanitizedText = String(context.text || '')
          .slice(0, 5000)
          .trim();
        const sanitizedUrl = String(context.url || '').slice(0, 2000);
        const sanitizedDomain = String(context.domain || '').slice(0, 500);
        const sanitizedTitle = String(context.title || '').slice(0, 500);

        if (!sanitizedText || !sanitizedUrl) {
          logger.warn(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_warn',
            message: String('[XyneAI] Browser context missing required fields'),
          });
          return;
        }

        // Set the browser context
        setBrowserContext({
          type: 'browser',
          text: sanitizedText,
          url: sanitizedUrl,
          domain: sanitizedDomain,
          title: sanitizedTitle,
          timestamp: Date.now(),
        });

        // Clear from session storage for security
        try {
          sessionStorage.removeItem('xyne-ai-browser-context');
        } catch (error) {
          logger.error(LogEvent.FRONTEND_ERROR, {
            type: 'migrated_console_error',
            message: String('[XyneAI] Failed to clear browser context from storage:'),
            error: error,
          });
        }

        // Don't auto-populate - let user type their own question
        // The context is in the pill, user can ask anything about it
      };

      // Listen for the custom event
      window.addEventListener(
        'xyne-ai-browser-context-ready',
        handleBrowserContext as EventListener,
      );

      // Also check sessionStorage on mount (in case event was missed)
      try {
        const stored = sessionStorage.getItem('xyne-ai-browser-context');
        if (stored) {
          const parsed = JSON.parse(stored) as BrowserContext;
          handleBrowserContext(
            new CustomEvent('xyne-ai-browser-context-ready', { detail: parsed }),
          );
        }
      } catch (error) {
        logger.error(LogEvent.FRONTEND_ERROR, {
          type: 'migrated_console_error',
          message: String('[XyneAI] Failed to parse browser context from storage:'),
          error: error,
        });
      }

      return () => {
        window.removeEventListener(
          'xyne-ai-browser-context-ready',
          handleBrowserContext as EventListener,
        );
      };
    }, []);

    // Handle removing canvas info - cascades to remove all its selections
    const removeCanvasInfo = (): void => {
      const canvasIdToRemove = activeCanvasInfo?.canvasId;

      // Clear canvas info
      setActiveCanvasInfo(null);

      if (canvasIdToRemove) {
        // Cascade: remove all selections for this canvas
        setActiveSelectionInfos(prev => {
          const newSelections = prev.filter(s => s.canvasId !== canvasIdToRemove);
          onSelectionInfosChange?.(newSelections);
          return newSelections;
        });

        // Send event to machine
        xyneAIActor.send({
          type: 'REMOVE_CANVAS_CONTEXT',
          canvasId: canvasIdToRemove,
        });
      }
    };

    // Handle removing a specific selection info
    const handleRemoveSelectionInfo = (index: number): void => {
      const selection = activeSelectionInfos[index];
      if (!selection) return;

      // Calculate the selection index relative to this canvas BEFORE modifying state
      // Use reference comparison for exact match to avoid issues with duplicate text
      const selectionIndex = activeSelectionInfos
        .filter(s => s.canvasId === selection.canvasId)
        .findIndex(s => s === selection);

      // Sync removal to the machine BEFORE state update
      xyneAIActor.send({
        type: 'REMOVE_SELECTION',
        canvasId: selection.canvasId,
        selectionIndex,
      });

      setActiveSelectionInfos(prev => {
        const newSelections = prev.filter((_, i) => i !== index);
        onSelectionInfosChange?.(newSelections);
        return newSelections;
      });
    };

    // Handle clicking selection pill to navigate
    const handleSelectionPillClick = (selection: SelectionInfo): void => {
      if (!selection?.canvasId) return;

      // Navigate to the canvas
      void navigate(`/chat/canvas/${selection.canvasId}`);

      // Close XyneAI modal on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    };

    // Handle clicking canvas pill to navigate
    const handleCanvasPillClick = (): void => {
      if (!activeCanvasInfo) return;

      // Navigate to the canvas
      void navigate(`/chat/canvas/${activeCanvasInfo.canvasId}`);

      // Close XyneAI modal on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    };

    // Destinations mirror the canonical navigators in utils/searchNavigation.ts,
    // so a canvas/transcript reached from search and from a pill land in the
    // same place. Each closes the sidebar on mobile, as the other pills do.
    const handleCanvasContextClick = (canvas: SelectedCanvas): void => {
      void navigate(`/chat/canvas/${canvas.canvasId ?? canvas.id}`);
      if (isMobile) xyneAIActor.send({ type: 'CLOSE' });
    };

    // `navigateToTranscript`: the chat location the transcript was shared at.
    // The call detail screen is not a valid target — it reads its call off
    // `location.state`, so a URL-only navigation renders an empty screen.
    const handleTranscriptContextClick = (transcript: SelectedTranscript): void => {
      const { channelId: transcriptChannelId, conversationId } = transcript;
      if (!transcriptChannelId) return;
      void navigate(
        conversationId
          ? `/chat/dir/${transcriptChannelId}/${conversationId}`
          : `/chat/dir/${transcriptChannelId}`,
      );
      if (isMobile) xyneAIActor.send({ type: 'CLOSE' });
    };

    // The transcript is what the pill actually attached, so show it in a modal
    // rather than routing away from the half-written question. Falls back to the
    // shared conversation when the search result didn't carry the recording id.
    const handleRecordingContextClick = (recording: SelectedRecording): void => {
      if (recording.externalId) {
        setTranscriptCallId(recording.externalId);
        return;
      }
      handleTranscriptContextClick(recording);
    };

    // Handle clicking browser context pill to open URL
    const handleBrowserContextClick = (): void => {
      if (!browserContext?.url) return;

      // Open URL in system browser or new window
      if (window.electronAPI?.openExternal) {
        window.electronAPI.openExternal(browserContext.url);
      } else {
        window.open(browserContext.url, '_blank', 'noopener,noreferrer');
      }
    };

    // Handle clicking thread pill to navigate
    const handleThreadPillClick = (): void => {
      if (!activeThreadInfo) return;

      // The channel pinned on the context at capture time, not the one the
      // sidebar currently points at — `SET_CHANNEL` repoints that on every chat
      // route change while the pill stays attached, so using it would route the
      // captured conversation into whatever channel happens to be open. Sessions
      // persisted before `threadInfo.channelId` existed fall back to it.
      const targetChannelId = activeThreadInfo.channelId ?? channelId;
      if (!targetChannelId) return;

      // Mirrors `navigateToMessage` in utils/searchNavigation.ts.
      //
      // Context taken from a channel message belongs to the channel, not to a
      // thread — routing without the conversation segment leaves the thread
      // panel closed, and `origin` alone is what highlights the conversation in
      // the channel list.
      //
      // Inside a thread we keep the dual hash: `origin` scrolls the channel list
      // to the parent conversation, `messageId` scrolls the thread panel to the
      // source message and flashes the highlight on it. Contexts that never set
      // the flag (tickets, calls, recordings) stay on this path.
      const { conversationId, messageId, isThreadMessage } = activeThreadInfo;

      if (isThreadMessage === false) {
        void navigate(`/chat/dir/${targetChannelId}#origin=${conversationId}`);
      } else {
        const hash = messageId
          ? `#origin=${conversationId}&messageId=${messageId}`
          : `#origin=${conversationId}`;
        void navigate(`/chat/dir/${targetChannelId}/${conversationId}${hash}`);
      }

      // Close XyneAI modal on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    };

    // Handle removing a selected collection pill
    const handleRemoveCollection = (collectionIdToRemove: string): void => {
      // Mark as manually removed so auto-add won't re-add it
      if (collectionIdToRemove === kbCollectionId) {
        autoAddedCollectionRemoved.current = true;
      }
      const newCollections = selectedCollections.filter(c => c.id !== collectionIdToRemove);
      setSelectedCollections(newCollections);
      onSelectedCollectionsChange?.(newCollections.map(c => c.id));
    };

    // Validate, read and attach files (file picker, paste, drag and drop).
    const handleFilesAdded = useCallback(
      async (files: File[]): Promise<void> => {
        const validFiles = files.filter(file => {
          const ext = file.name.split('.').pop()?.toLowerCase();
          return !ext || !blockedExtensions.has(`.${ext}`);
        });
        if (validFiles.length === 0) {
          toast.error('The selected file type is not allowed for security reasons.', {
            duration: 3000,
          });
          return;
        }
        const oversizedFiles = validFiles.filter(file => file.size > MAX_INDIVIDUAL_FILE_SIZE);
        if (oversizedFiles.length > 0) {
          const fileNames = oversizedFiles.map(f => f.name).join(', ');
          toast.error(`File(s) too large: ${fileNames}. Maximum file size is 10MB.`, {
            duration: 4000,
          });
          return;
        }
        if (selectedAttachments.length + validFiles.length > MAX_FILE_COUNT) {
          toast.error(
            `You can attach up to ${MAX_FILE_COUNT} files per conversation. Remove some attachments before adding more.`,
            { duration: 4000 },
          );
          return;
        }
        const existingTotalSize = selectedAttachments.reduce((sum, att) => sum + att.size, 0);
        const newFilesSize = validFiles.reduce((sum, file) => sum + file.size, 0);
        if (existingTotalSize + newFilesSize > MAX_TOTAL_SIZE) {
          const totalMB = Math.round((existingTotalSize + newFilesSize) / (1024 * 1024));
          toast.error(
            `Total attachment size (${totalMB}MB) exceeds the 25MB limit. Please remove some attachments.`,
            { duration: 4000 },
          );
          return;
        }
        const filePromises = validFiles.map(
          file =>
            new Promise<Attachment>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (): void => {
                const result = reader.result as string;
                const base64Match = result.match(/^data:([^;]+);base64,(.+)$/);
                if (!base64Match) {
                  reject(
                    new Error(`Invalid file format - not a valid data URL for file: ${file.name}`),
                  );
                  return;
                }
                const [, detectedMimeType, base64Data] = base64Match;
                if (!base64Data) {
                  reject(new Error(`Empty file data for file: ${file.name}`));
                  return;
                }
                if (detectedMimeType !== file.type) {
                  logger.warn(LogEvent.FRONTEND_ERROR, {
                    type: 'migrated_console_warn',
                    message: String(
                      `[XyneAI] MIME type mismatch for ${file.name}: file.type=${file.type}, detected=${detectedMimeType}`,
                    ),
                  });
                }
                if (!isValidBase64(base64Data)) {
                  reject(new Error(`Invalid base64 data for file: ${file.name}`));
                  return;
                }
                resolve({
                  id: `${file.name}-${Date.now()}-${Math.random()}`,
                  name: file.name,
                  size: file.size,
                  type: file.type,
                  file,
                  data: base64Data,
                  mimeType: file.type,
                  filename: file.name,
                });
              };
              reader.onerror = reject;
              reader.readAsDataURL(file);
            }),
        );
        try {
          const newAttachments = await Promise.all(filePromises);
          setSelectedAttachments(prev => [...prev, ...newAttachments]);
          if (newAttachments.length > 1) {
            toast.success(`${newAttachments.length} files attached successfully`, {
              duration: 2000,
            });
          }
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Error reading files. Please try again.';
          toast.error(errorMessage, { duration: 3000 });
        }
      },
      [selectedAttachments],
    );

    // Notify parent component when attachments change
    useEffect(() => {
      onAttachmentsChange?.(selectedAttachments);
    }, [selectedAttachments, onAttachmentsChange]);

    // Attachments belong to the message: a cleared input (after send) drops them.
    useEffect(() => {
      if (inputValue === '') setSelectedAttachments([]);
    }, [inputValue]);

    // Expose imperative API for drag and drop
    useImperativeHandle(
      ref,
      () => ({
        addFiles: (files: File[]): void => {
          if (files.length > 0) void handleFilesAdded(files);
        },
        clearContent: (): void => {
          composerRef.current?.clear();
          setSelectedAttachments([]);
        },
        insertContent: (content: string): void => composerRef.current?.insertText(content),
        isSuggestionOpen: (): boolean => composerRef.current?.isMenuOpen() ?? false,
        focus: (): void => composerRef.current?.focus(),
      }),
      [handleFilesAdded],
    );

    // Notify parent when browser context changes
    useEffect(() => {
      onBrowserContextChange?.(browserContext);
    }, [browserContext, onBrowserContextChange]);

    // ── Picked context ───────────────────────────────────────────────────
    // Picks and removals rebuild the full ContextSelections from current props
    // and push it up through onContextSelectionsChange, so the pills, the
    // menus' check marks and submit all read one source. A ref carries the
    // latest value so two quick picks don't both start from the same render.
    const currentSelections = useMemo<ContextSelections>(
      () => ({
        channels: selectedChannels,
        tickets: selectedTickets,
        canvases: selectedCanvases,
        transcripts: selectedTranscripts,
        recordings: selectedRecordings,
        messages: selectedMessages,
        people: selectedPeople,
        sharedFiles: selectedSharedFiles,
        apps: selectedApps,
        localFolders: [],
      }),
      [
        selectedChannels,
        selectedTickets,
        selectedCanvases,
        selectedTranscripts,
        selectedRecordings,
        selectedMessages,
        selectedPeople,
        selectedSharedFiles,
        selectedApps,
      ],
    );
    const selectionsRef = useRef(currentSelections);
    useEffect(() => {
      selectionsRef.current = currentSelections;
    }, [currentSelections]);

    const kbCount = selectedCollections.length + fileScopes.length + folderScopes.length;
    const handlePick = useCallback(
      (item: PickedContext): boolean => {
        const result = addPicked(selectionsRef.current, item, kbCount);
        if ('error' in result) {
          toast.error(result.error, { duration: 2500 });
          return false;
        }
        selectionsRef.current = result.next;
        onContextSelectionsChange?.(result.next);
        return true;
      },
      [kbCount, onContextSelectionsChange],
    );
    const handleUnpick = useCallback(
      (target: ContextRef): void => {
        const next = removePicked(selectionsRef.current, target);
        selectionsRef.current = next;
        onContextSelectionsChange?.(next);
      },
      [onContextSelectionsChange],
    );
    const pickedRefs = useMemo(() => pickedRefsOf(currentSelections), [currentSelections]);

    const trayItems = useMemo<ComposerTrayItem[]>(() => {
      const items: ComposerTrayItem[] = [];
      if (activeThreadInfo) {
        items.push({
          key: 'thread',
          icon: activeThreadInfo.senderId ? (
            <Avatar
              userId={activeThreadInfo.senderId}
              size='xs'
              rounded
              showActiveStatus={false}
              className='size-4'
            />
          ) : (
            <ChatDefault className='size-4' />
          ),
          label: `${!activeThreadInfo.senderId && activeThreadInfo.senderName ? `${activeThreadInfo.senderName}: ` : ''}${activeThreadInfo.previewText}`,
          ...(activeThreadInfo.senderName ? { title: activeThreadInfo.senderName } : {}),
          onClick: handleThreadPillClick,
          onRemove: () => {
            setActiveThreadInfo(null);
            onThreadInfoChange?.(null);
          },
        });
      }
      if (activeCanvasInfo) {
        items.push({
          key: 'canvas-info',
          icon: <File02Text className='size-4' />,
          label: activeCanvasInfo.title || 'Untitled Canvas',
          onClick: handleCanvasPillClick,
          onRemove: () => removeCanvasInfo(),
        });
      }
      if (workflowInfo) {
        items.push({
          key: 'workflow-info',
          icon: <Automation className='size-4' />,
          label: `${workflowInfo.title || 'This workflow'}${workflowInfo.executionId ? ' · run' : ''}`,
          ...(onRemoveWorkflowInfo
            ? {
                onRemove: (): void =>
                  onRemoveWorkflowInfo({ stopPropagation: () => undefined } as React.MouseEvent),
              }
            : {}),
        });
      }
      activeSelectionInfos.forEach((selection, index) => {
        items.push({
          key: `selection-${selection.canvasId}-${index}`,
          icon: <FileText className='size-4' />,
          label: selection.preview,
          onClick: () => handleSelectionPillClick(selection),
          onRemove: () => handleRemoveSelectionInfo(index),
        });
      });
      if (browserContext) {
        items.push({
          key: 'browser',
          icon: <Globe className='size-4' />,
          label: `${browserContext.text.slice(0, 50)}${browserContext.text.length > 50 ? '…' : ''} • ${browserContext.domain}`,
          title: `${browserContext.title}\n${browserContext.url}`,
          onClick: handleBrowserContextClick,
          onRemove: () => setBrowserContext(null),
        });
      }
      items.push(
        ...selectionTrayItems(currentSelections, handleUnpick, {
          canvas: handleCanvasContextClick,
          transcript: handleTranscriptContextClick,
          recording: handleRecordingContextClick,
        }),
      );
      items.push(
        ...knowledgeTrayItems(selectedCollections, folderScopes, fileScopes, {
          collection: handleRemoveCollection,
          folder: id => onFolderScopesChange?.(folderScopes.filter(f => f.id !== id)),
          file: id => onFileScopesChange?.(fileScopes.filter(f => f.id !== id)),
        }),
      );
      if (selectedActivities.length > 0) {
        items.push({
          key: 'activities',
          icon: <Activity className='size-4' aria-hidden />,
          label: `${selectedActivities.length} ${selectedActivities.length === 1 ? 'activity' : 'activities'}`,
          ...(onActivitiesChange ? { onRemove: (): void => onActivitiesChange([]) } : {}),
        });
      }
      return items;
      // The click/remove handlers are recreated each render; the data they act
      // on is what decides when the pills change.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
      activeThreadInfo,
      activeCanvasInfo,
      workflowInfo,
      activeSelectionInfos,
      browserContext,
      currentSelections,
      selectedCollections,
      folderScopes,
      fileScopes,
      selectedActivities,
    ]);

    // /design renders into the AI screen's design workspace; the panel has
    // none, so its HTML would land in the chat as raw text.
    const panelCommands = useMemo(
      () => commandsForSurface('ai-screen').filter(command => command.name !== 'design'),
      [],
    );

    // Gutter lives on the composer-container in the parent (see the Figma
    // frame: composer-container owns px/pb, composer is w-full).
    return (
      <div className='relative w-full'>
        <RecordingTranscriptModal
          callId={transcriptCallId}
          onClose={() => setTranscriptCallId(null)}
        />
        <input
          ref={fileInputRef}
          type='file'
          multiple
          onChange={e => {
            const files = e.target.files;
            if (files && files.length > 0) void handleFilesAdded(Array.from(files));
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
          className='hidden'
          aria-label='Upload files'
        />
        <Composer
          ref={composerRef}
          value={inputValue}
          onValueChange={onInputChange}
          isStreaming={isStreaming}
          onSubmit={trigger => onSubmit(trigger)}
          onStop={() => onAbort?.()}
          sendTrackingMetadata={JSON.stringify(
            aiSendButtonTrackingMetadata({
              surface: 'panel',
              agentSlug: selectedAgentSlug,
              model: selectedModel,
              thinkingLevel,
              webSearchEnabled,
              deepResearchEnabled,
              createCanvasEnabled,
            }),
          )}
          trayItems={isOnboarding ? [] : trayItems}
          attachments={selectedAttachments.map(a => ({
            key: a.id,
            file: a.file,
            onRemove: (): void =>
              setSelectedAttachments(prev => prev.filter(att => att.id !== a.id)),
          }))}
          pickedRefs={pickedRefs}
          onPick={handlePick}
          onUnpick={handleUnpick}
          {...(onUserTagsChange ? { onUserTagsChange } : {})}
          commands={panelCommands}
          plus={{
            onAttachFiles: () => fileInputRef.current?.click(),
            knowledge: {
              agent: agents.find(a => a.slug === selectedAgentSlug) ?? null,
              collections: selectedCollections,
              folders: folderScopes,
              files: fileScopes,
              onChange: handleKnowledgeChange,
            },
            createCanvasEnabled,
            ...(onCreateCanvasToggle ? { onCreateCanvasToggle } : {}),
            webSearchEnabled,
            webSearchAccessible,
            ...(onWebSearchToggle ? { onWebSearchToggle } : {}),
            deepResearchEnabled,
            deepResearchAccessible,
            ...(onDeepResearchToggle ? { onDeepResearchToggle } : {}),
          }}
          agent={
            onSelectAgent
              ? {
                  agents,
                  selectedSlug: selectedAgentSlug,
                  isAuto,
                  canAuto: onSelectAuto !== undefined,
                  onSelect: (slug): void => {
                    if (slug === null) rememberNoAgentChoice('ask-ai');
                    onSelectAgent(slug);
                  },
                  onSelectAuto: (): void => {
                    rememberNoAgentChoice('auto');
                    onSelectAuto?.();
                  },
                }
              : null
          }
          model={
            onSelectModel
              ? {
                  models,
                  defaultModel,
                  defaultModelName,
                  selectedModel,
                  onSelectModel,
                  thinkingLevel,
                  onSelectThinking: onSelectThinking ?? ((): void => undefined),
                  loading: modelsLoading,
                }
              : null
          }
          {...(onEnterVoiceMode ? { onEnterVoiceMode } : {})}
          onFilesPasted={files => void handleFilesAdded(files)}
          hideToolbar={isOnboarding}
        />
      </div>
    );
  },
);

XyneAIInputBox.displayName = 'XyneAIInputBox';
