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
import {
  ArrowUp,
  X,
  Plus,
  FileText,
  Lock,
  Globe,
  Code2,
  Package,
  Search,
  File,
  Ticket,
  Phone,
  Mic,
  Microscope,
  Hash,
  BookOpen,
  ChevronRight,
  ArrowLeft,
  Folder,
} from 'lucide-react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Mark } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';

const VoiceShimmerMark = Mark.create({
  name: 'voiceShimmer',
  parseHTML() {
    return [];
  },
  renderHTML() {
    return ['span', { class: 'voice-shimmer' }, 0];
  },
});
import Placeholder from '@tiptap/extension-placeholder';
import LinkExtension from '@tiptap/extension-link';
import { LinkSyncPlugin } from '../../../ui/TipTapExtensions/LinkSyncPlugin';
import { toast } from 'sonner';
import { VoiceInput } from '../../../ui/InputBox/VoiceInput';
import type { VoiceInputHandle } from '../../../ui/InputBox/VoiceInput';
import { StopIcon } from './StopIcon';
import { AgentSelector } from './AgentSelector';
import type { AgentOption } from './AgentSelector';
import {
  ChannelMentionExtension,
  channelMentionPluginKey,
  MentionExtension,
  mentionPluginKey,
} from '../../../ui/TipTapExtensions';
import { MentionSelector } from '../../../ui/Selectors';
import type { MentionResult } from '../../../ui/Selectors/Selectors.types';
import { usePlatform } from '../../../../hooks/usePlatform';
import { useResearchOptions, type ResearchContext } from '../../../../hooks/useResearchAgent';
import type { CollectionSummary } from '../../../../services/Knowledge/collectionService';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import type { ThreadInfo, CanvasInfo, SelectionInfo } from '../../../../machines/xyneAIMachine';
import type { VisibleChannel } from '../../../../machines/stateMachine';
import { useNavigate } from 'react-router-dom';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { DANGEROUS_EXTENSIONS } from '@xyne/shared';

// Hash icon component
const HashIcon = ({ className = '' }: { className?: string }): ReactElement => (
  <Hash className={className} size={16} />
);

import type { UserActivity } from '../../../../hooks/useUserActivity';
import type { UserTag } from '../utils/XyneAITypes';
import { useMentionSearch } from '../../../../hooks/useMentionSearch';
import type {
  SelectedChannel,
  SelectedTicket,
  SelectedCanvas,
  SelectedTranscript,
  SelectedRecording,
} from './ContextPickerPanel';

// Browser context interface
interface BrowserContext {
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
// and cause useEffect deps like `[selectionInfos]` / `[nonDMChannels, …]`
// to fire on every render, blowing up downstream consumers with infinite
// setState→render loops.
const EMPTY_SELECTION_INFOS: SelectionInfo[] = [];
const EMPTY_CHANNELS: SelectedChannel[] = [];
const EMPTY_NON_DM_CHANNELS: VisibleChannel[] = [];
const EMPTY_TICKETS: SelectedTicket[] = [];
const EMPTY_CANVASES: SelectedCanvas[] = [];
const EMPTY_TRANSCRIPTS: SelectedTranscript[] = [];
const EMPTY_RECORDINGS: SelectedRecording[] = [];
const EMPTY_ACTIVITIES: UserActivity[] = [];

export interface XyneAIInputBoxProps {
  channelId?: string | null;
  channelName?: string;
  channelDescription?: string;
  scopeType?: string;
  showChannelTag?: boolean;
  threadInfo?: ThreadInfo | null | undefined;
  canvasInfo?: CanvasInfo | null | undefined;
  selectionInfos?: SelectionInfo[];
  inputValue: string;
  onInputChange: (value: string) => void;
  onSubmit: () => void;
  onSelectedCollectionsChange?: (collectionIds: string[]) => void;
  onResearchContextChange?: (context: ResearchContext | null) => void;
  onThreadInfoChange?: (threadInfo: ThreadInfo | null) => void;
  onSelectionInfosChange?: (selectionInfos: SelectionInfo[]) => void;
  onAttachmentsChange?: (attachments: Attachment[]) => void;
  onBrowserContextChange?: (context: BrowserContext | null) => void;
  selectedChannels?: SelectedChannel[];
  onRemoveChannel?: (id: string) => void;
  onAddChannel?: (channel: SelectedChannel) => void;
  nonDMChannels?: VisibleChannel[];
  onOpenContextModal?: () => void;
  onCloseContextModal?: () => void;
  isContextModalOpen?: boolean;
  selectedTickets?: SelectedTicket[];
  onRemoveTicket?: (id: string) => void;
  selectedCanvases?: SelectedCanvas[];
  onRemoveCanvas?: (id: string) => void;
  selectedTranscripts?: SelectedTranscript[];
  onRemoveTranscript?: (id: string) => void;
  selectedRecordings?: SelectedRecording[];
  onRemoveRecording?: (id: string) => void;
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
  agents?: AgentOption[];
  onSelectAgent?: (slug: string | null) => void;
  kbCollectionId?: string | undefined;
  collectionsList?: CollectionSummary[];
  /** When Ask AI is opened from a file viewer, scopes retrieval to this single file. */
  fileScope?: { id: string; name: string } | null;
  onRemoveFileScope?: () => void;
  /** Select a file from the picker as scope (id = the file's Vespa docId / fileId UUID). */
  onSelectFileScope?: (file: { id: string; name: string }) => void;
  compactToolbar?: boolean;
  tightToolbar?: boolean;
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

export const XyneAIInputBox = forwardRef<XyneAIInputBoxHandle, XyneAIInputBoxProps>(
  (
    {
      channelId,
      channelName: _channelName,
      scopeType: _scopeType,
      threadInfo,
      canvasInfo,
      selectionInfos = EMPTY_SELECTION_INFOS,
      inputValue,
      onInputChange,
      onSubmit,
      onSelectedCollectionsChange,
      onResearchContextChange,
      onThreadInfoChange,
      onSelectionInfosChange,
      onAttachmentsChange,
      onBrowserContextChange,
      selectedChannels = EMPTY_CHANNELS,
      onRemoveChannel,
      onAddChannel,
      nonDMChannels = EMPTY_NON_DM_CHANNELS,
      onOpenContextModal,
      onCloseContextModal,
      isContextModalOpen = false,
      selectedTickets = EMPTY_TICKETS,
      onRemoveTicket,
      selectedCanvases = EMPTY_CANVASES,
      onRemoveCanvas,
      selectedTranscripts = EMPTY_TRANSCRIPTS,
      onRemoveTranscript,
      selectedRecordings = EMPTY_RECORDINGS,
      onRemoveRecording,
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
      fileScope = null,
      onRemoveFileScope,
      onSelectFileScope,
      onUserTagsChange,
      isOnboarding = false,
      selectedAgentSlug = null,
      agents = [],
      onSelectAgent,
      collectionsList: collectionsListProp = [],
      compactToolbar = false,
      tightToolbar = false,
    },
    ref,
  ): ReactElement => {
    const researchDropdownRef = useRef<HTMLDivElement>(null);
    const collectionDropdownRef = useRef<HTMLDivElement>(null);
    const researchSearchInputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const hasAutoFocusedRef = useRef(false);
    const isContextModalOpenRef = useRef(isContextModalOpen);
    const onCloseContextModalRef = useRef(onCloseContextModal);
    const onOpenContextModalRef = useRef(onOpenContextModal);
    useEffect(() => {
      isContextModalOpenRef.current = isContextModalOpen;
    }, [isContextModalOpen]);
    useEffect(() => {
      onCloseContextModalRef.current = onCloseContextModal;
    }, [onCloseContextModal]);
    useEffect(() => {
      onOpenContextModalRef.current = onOpenContextModal;
    }, [onOpenContextModal]);
    const { isMobile } = usePlatform();
    const navigate = useNavigate();

    // Voice input
    const voiceInputRef = React.useRef<VoiceInputHandle>(null);
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);

    // Get user mentions using the existing hook
    const { results: mentionResults, searchMentions } = useMentionSearch(channelId ?? undefined);

    // Get research agent products and repositories (lazy-loaded)
    const {
      products,
      repositories,
      isLoading: isResearchLoading,
      triggerFetch: triggerResearchFetch,
      hasFetched: hasResearchFetched,
    } = useResearchOptions();

    const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>([]);

    // Channel search state for # mentions
    const [channelSearchQuery, setChannelSearchQuery] = useState('');

    // Research Agent state
    const [selectedResearch, setSelectedResearch] = useState<ResearchContext | null>(null);
    const [showResearchDropdown, setShowResearchDropdown] = useState(false);
    const [researchSearchQuery, setResearchSearchQuery] = useState('');
    const [researchHighlightedIndex, setResearchHighlightedIndex] = useState(0);
    const [researchTab, setResearchTab] = useState<'products' | 'repositories'>('products');

    // Collection state
    const [selectedCollections, setSelectedCollections] = useState<{ id: string; name: string }[]>(
      [],
    );
    const [showCollectionDropdown, setShowCollectionDropdown] = useState(false);
    const [collectionSearchQuery, setCollectionSearchQuery] = useState('');
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

    // Filter collections based on search query
    const filteredCollections = useMemo(() => {
      if (!collectionSearchQuery.trim()) return collectionsList;
      const query = collectionSearchQuery.toLowerCase();
      return collectionsList.filter(
        col =>
          col.name.toLowerCase().includes(query) || col.description?.toLowerCase().includes(query),
      );
    }, [collectionsList, collectionSearchQuery]);

    // Hierarchical file-browser for the KB picker. navStack = path of opened
    // nodes: [] = collections list; [0] = the collection (root); deeper = subfolders.
    // Double-click a collection/folder to open it; single-click a collection to
    // (de)select it; click a file to scope Ask AI to it.
    const [navStack, setNavStack] = useState<Array<{ id: string; name: string }>>([]);
    const inFolderView = navStack.length > 0;
    const rootCollectionId = navStack[0]?.id ?? '';
    const currentFolderId = navStack[navStack.length - 1]?.id ?? '';

    const [allSubfolders] = useCachedQuery(
      queries.collectionSubfolders({ rootCollectionId }),
      inFolderView && !!rootCollectionId,
    );
    const [currentFolderItems] = useCachedQuery(
      queries.collectionItems({ collectionId: currentFolderId }),
      inFolderView && !!currentFolderId,
    );

    const fileQuery = collectionSearchQuery.trim().toLowerCase();
    const currentSubfolders = useMemo(
      () =>
        (allSubfolders ?? [])
          .filter(f => (f as { parentId?: string | null }).parentId === currentFolderId)
          .filter(f => !fileQuery || (f as { name: string }).name.toLowerCase().includes(fileQuery))
          .map(f => ({ id: (f as { id: string }).id, name: (f as { name: string }).name })),
      [allSubfolders, currentFolderId, fileQuery],
    );
    const currentFiles = useMemo(
      () =>
        (currentFolderItems ?? [])
          .map(it => ({
            fileId: (it as { fileId?: string }).fileId ?? '',
            name: (it as { name: string }).name,
          }))
          .filter(it => it.fileId && (!fileQuery || it.name.toLowerCase().includes(fileQuery))),
      [currentFolderItems, fileQuery],
    );

    // Reset navigation whenever the picker closes.
    useEffect(() => {
      if (!showCollectionDropdown) {
        setNavStack([]);
        setCollectionSearchQuery('');
      }
    }, [showCollectionDropdown]);

    // Disambiguate single-click (select collection) from double-click (open it).
    const collectionClickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const openNode = useCallback((node: { id: string; name: string }) => {
      if (collectionClickTimer.current) {
        clearTimeout(collectionClickTimer.current);
        collectionClickTimer.current = null;
      }
      setCollectionSearchQuery('');
      setNavStack(prev => [...prev, node]);
    }, []);

    const handleCollectionSingleClick = useCallback(
      (collection: { id: string; name: string }) => {
        if (collectionClickTimer.current) return; // a double-click is in progress
        collectionClickTimer.current = setTimeout(() => {
          collectionClickTimer.current = null;
          // Single-select: at most ONE collection. Clicking the selected one clears it.
          setSelectedCollections(prev => {
            const isCurrent = prev.length === 1 && prev[0]?.id === collection.id;
            const updated = isCurrent ? [] : [{ id: collection.id, name: collection.name }];
            onSelectedCollectionsChange?.(updated.map(c => c.id));
            return updated;
          });
          // Choosing a collection = collection-level scope → drop any single-file scope.
          onRemoveFileScope?.();
        }, 220);
      },
      [onSelectedCollectionsChange, onRemoveFileScope],
    );

    // Pick a file: scope Ask AI to just that file, and ensure its (root) collection is
    // selected so the KB tool stays enabled + the collection filter applies.
    const handleSelectFile = useCallback(
      (file: { fileId: string; name: string }) => {
        onSelectFileScope?.({ id: file.fileId, name: file.name });
        // Single-select: the file's (root) collection becomes the ONLY selected collection.
        const col = navStack[0];
        const updated = col ? [col] : [];
        setSelectedCollections(updated);
        onSelectedCollectionsChange?.(updated.map(c => c.id));
        setShowCollectionDropdown(false);
      },
      [onSelectFileScope, navStack, onSelectedCollectionsChange],
    );

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
          console.warn('[XyneAI] Invalid browser context received');
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
          console.warn('[XyneAI] Browser context missing required fields');
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
          console.error('[XyneAI] Failed to clear browser context from storage:', error);
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
        console.error('[XyneAI] Failed to parse browser context from storage:', error);
      }

      return () => {
        window.removeEventListener(
          'xyne-ai-browser-context-ready',
          handleBrowserContext as EventListener,
        );
      };
    }, []);

    const handleAttachFiles = useCallback((): void => {
      fileInputRef.current?.click();
    }, []);

    // Handle removing thread info
    const handleRemoveThreadInfo = (e: React.MouseEvent): void => {
      e.stopPropagation(); // Prevent triggering the pill click
      setActiveThreadInfo(null);
      onThreadInfoChange?.(null);
    };

    // Handle removing canvas info - cascades to remove all its selections
    const handleRemoveCanvasInfo = (e: React.MouseEvent): void => {
      e.stopPropagation(); // Prevent triggering the pill click
      const viewAccessId = activeCanvasInfo?.viewAccessId;

      // Clear canvas info
      setActiveCanvasInfo(null);

      if (viewAccessId) {
        // Cascade: remove all selections for this canvas
        setActiveSelectionInfos(prev => {
          const newSelections = prev.filter(s => s.canvasViewAccessId !== viewAccessId);
          onSelectionInfosChange?.(newSelections);
          return newSelections;
        });

        // Send event to machine
        xyneAIActor.send({
          type: 'REMOVE_CANVAS_CONTEXT',
          viewAccessId,
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
        .filter(s => s.canvasViewAccessId === selection.canvasViewAccessId)
        .findIndex(s => s === selection);

      // Sync removal to the machine BEFORE state update
      xyneAIActor.send({
        type: 'REMOVE_SELECTION',
        viewAccessId: selection.canvasViewAccessId,
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
      if (!selection?.canvasViewAccessId) return;

      // Navigate to the canvas
      void navigate(`/chat/canvas/${selection.canvasViewAccessId}`);

      // Close XyneAI modal on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    };

    // Handle clicking canvas pill to navigate
    const handleCanvasPillClick = (): void => {
      if (!activeCanvasInfo) return;

      // Navigate to the canvas
      void navigate(`/chat/canvas/${activeCanvasInfo.viewAccessId}`);

      // Close XyneAI modal on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    };

    // Handle removing browser context
    const handleRemoveBrowserContext = (e: React.MouseEvent): void => {
      e.stopPropagation();
      setBrowserContext(null);
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
      if (!activeThreadInfo || !channelId) return;

      // Navigate to the thread
      void navigate(`/chat/dir/${channelId}/${activeThreadInfo.conversationId}`);

      // Close XyneAI modal on mobile after navigation
      if (isMobile) {
        xyneAIActor.send({ type: 'CLOSE' });
      }
    };

    // TipTap editor setup
    const editor = useEditor({
      extensions: [
        StarterKit.configure({
          paragraph: {
            HTMLAttributes: {
              class: 'm-0 leading-6',
            },
          },
        }),
        Placeholder.configure({
          placeholder: 'Ask Xyne AI',
        }),
        LinkExtension.extend({
          inclusive: false,
        }).configure({
          openOnClick: false,
          HTMLAttributes: {
            class:
              'text-[color:var(--link-color)] hover:text-[color:var(--link-hover-color)] underline cursor-text',
            rel: 'noopener noreferrer',
          },
        }),
        LinkSyncPlugin,
        MentionExtension.configure({
          userActions: [],
          groupActions: [],
        }),
        ChannelMentionExtension,
        VoiceShimmerMark,
      ],
      content: '',
      onUpdate: ({ editor }) => {
        const text = editor.getText();
        onInputChange(text);
      },
      editorProps: {
        attributes: {
          class: 'tiptap chat-input-editor prose prose-sm focus:outline-none',
          style: 'min-height: 20px; max-height: 140px; overflow-y: auto;',
          role: 'textbox',
          'aria-multiline': 'true',
          spellcheck: 'true',
          autocorrect: 'on',
          autocapitalize: 'sentences',
          autocomplete: 'on',
        },
        handleKeyDown: (view, event) => {
          // Any key typed while modal is open (printable char, '/', or backspace) → close modal
          if (isContextModalOpenRef.current) {
            const isChar =
              event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey;
            if (isChar || event.key === 'Backspace') {
              onCloseContextModalRef.current?.();
              // Let the character be typed into the editor
              return false;
            }
          }

          // '/' when modal is NOT open → open the modal
          if (event.key === '/' && !isContextModalOpenRef.current) {
            onOpenContextModalRef.current?.();
            // Let '/' be typed into the editor
            return false;
          }

          // Escape closes the context modal when it's open
          if (event.key === 'Escape' && isContextModalOpenRef.current) {
            event.preventDefault();
            onCloseContextModalRef.current?.();
            return true;
          }

          if (event.key === 'Enter' && !event.shiftKey) {
            const mentionState = mentionPluginKey.getState(view.state);
            const channelMentionState = channelMentionPluginKey.getState(view.state);

            // If channel mention menu is open, let it handle the Enter key
            if (
              (mentionState?.isOpen && mentionState.items.length > 0) ||
              (channelMentionState?.isOpen && channelMentionState.items.length > 0)
            ) {
              return false;
            }

            // If channel mention menu is open, let it handle the Enter key
            if (channelMentionState?.isOpen && channelMentionState.items.length > 0) {
              return false;
            }

            // Prevent submission if already streaming or input is empty
            const text = view.state.doc.textContent.trim();
            if (isStreaming || !text) {
              event.preventDefault();
              return true;
            }

            // Otherwise, submit the message
            event.preventDefault();
            onSubmit();
            return true;
          }

          return false;
        },
        handlePaste: (_view, event) => {
          const clipboard = event.clipboardData;

          /** Handle File Pasting */
          const files = clipboard?.files ?? [];
          if (files.length > 0) {
            void handleFilesAdded(Array.from(files));
          }

          const pastedText = clipboard?.getData('text');

          /** Handle large text paste as file attachment */
          if (pastedText && pastedText.length > 11500) {
            event.preventDefault();

            // Check if attachment limit has been reached before adding text file
            if (selectedAttachments.length >= 10) {
              return true;
            }

            // Try to parse as JSON to determine file type
            let fileName: string;
            let fileType: string;
            let blobContent: Blob;

            try {
              // Attempt to parse the text as JSON
              JSON.parse(pastedText);
              // If successful, create a JSON file
              fileName = `pasted-text-${Date.now()}.json`;
              fileType = 'application/json';
              blobContent = new Blob([pastedText], { type: fileType });
            } catch {
              // If parsing fails, create a text file
              fileName = `pasted-text-${Date.now()}.txt`;
              fileType = 'text/plain';
              blobContent = new Blob([pastedText], { type: fileType });
            }

            const file = new globalThis.File([blobContent], fileName, { type: fileType });
            void handleFilesAdded([file]);
            editor?.commands.setContent('');
            onInputChange('');
            return true;
          }
          return false;
        },
      },
    });

    // TipTap requires editor.commands.focus() — DOM .focus() doesn't properly focus the editor
    useEffect(() => {
      if (!editor || hasAutoFocusedRef.current) return;

      hasAutoFocusedRef.current = true;

      const active = document.activeElement;
      if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
        return;
      }

      const rafId = requestAnimationFrame(() => {
        editor.commands.focus();
      });

      return () => cancelAnimationFrame(rafId);
    }, [editor]);

    useEffect(() => {
      if (isMobile) return;
      const rafId = requestAnimationFrame(() => {
        researchSearchInputRef.current?.focus();
      });
      return () => cancelAnimationFrame(rafId);
    }, [researchTab]);

    // Notify parent component when attachments change
    useEffect(() => {
      onAttachmentsChange?.(selectedAttachments);
    }, [selectedAttachments, onAttachmentsChange]);

    // Sync inputValue changes from parent to editor (skip during voice recording)
    useEffect(() => {
      if (editor && !editor.isFocused) {
        const currentText = editor.getText();
        if (currentText !== inputValue) {
          editor.commands.setContent(inputValue);
        }
      }
    }, [inputValue, editor]);

    // Clear editor content and attachments when inputValue is empty (after submit)
    useEffect(() => {
      if (inputValue === '' && editor) {
        editor.commands.setContent('');
        // Also clear attachments when input is cleared
        setSelectedAttachments([]);
      }
    }, [inputValue, editor]);

    // Convert channels to MentionResult format for MentionSelector (exclude DMs), filtered by search query
    const channelMentionItems: MentionResult[] = useMemo(() => {
      const query = channelSearchQuery.toLowerCase();
      return nonDMChannels
        .filter(channel => !query || channel.name.toLowerCase().includes(query))
        .map(channel => ({
          id: channel.id,
          name: channel.name,
          type: 'channel' as const,
          isPrivate: String(channel.visibility) === 'PRIVATE',
          ...(channel.description && { description: channel.description }),
        }));
    }, [nonDMChannels, channelSearchQuery]);

    // Handle channel search from # mention trigger
    const handleChannelSearch = useCallback((query: string) => {
      setChannelSearchQuery(query);
    }, []);

    // Handle channel mention selection from TipTap selector
    const handleChannelMentionSelect = useCallback(
      (mention: MentionResult) => {
        if (mention.type !== 'channel') return;

        // Check if channel is already selected
        if (selectedChannels.some(ch => ch.id === mention.id)) {
          toast.info('This channel is already added to context', { duration: 2000 });
          return;
        }

        // Check if maximum limit of 5 channels is reached
        if (selectedChannels.length >= 5) {
          toast.error('Maximum 5 channels can be selected', { duration: 2000 });
          return;
        }

        // Add channel via parent callback
        onAddChannel?.({
          id: mention.id,
          name: mention.name,
          isPrivate: mention.isPrivate ?? false,
        });
      },
      [selectedChannels, onAddChannel],
    );

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

    // File size limits
    const MAX_INDIVIDUAL_FILE_SIZE = 100 * 1024 * 1024; // 100MB in bytes
    const MAX_TOTAL_SIZE = 200 * 1024 * 1024; // 200MB in bytes

    // Blocked file extensions (security blocklist approach — all types allowed except dangerous ones)
    const blockedExtensions = new Set(DANGEROUS_EXTENSIONS.map(ext => ext.toLowerCase()));

    // Validate base64 string
    const isValidBase64 = (str: string): boolean => {
      if (!str || str.length === 0) return false;
      // Base64 regex: only allows valid base64 characters (A-Z, a-z, 0-9, +, /, =)
      const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
      if (!base64Regex.test(str)) return false;
      // Check if length is valid (must be multiple of 4)
      if (str.length % 4 !== 0) return false;
      return true;
    };

    // Handle file selection
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
      const files = event.target.files;
      if (!files || files.length === 0) return;

      // Filter out dangerous file types (blocklist approach)
      const validFiles = Array.from(files).filter(file => {
        const ext = file.name.split('.').pop()?.toLowerCase();
        return !ext || !blockedExtensions.has(`.${ext}`);
      });

      if (validFiles.length === 0) {
        toast.error('The selected file type is not allowed for security reasons.', {
          duration: 3000,
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      // Check individual file size
      const oversizedFiles = validFiles.filter(file => file.size > MAX_INDIVIDUAL_FILE_SIZE);
      if (oversizedFiles.length > 0) {
        const fileNames = oversizedFiles.map(f => f.name).join(', ');
        toast.error(`File(s) too large: ${fileNames}. Maximum file size is 100MB.`, {
          duration: 4000,
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      // Calculate total size of existing attachments
      const existingTotalSize = selectedAttachments.reduce((sum, att) => sum + att.size, 0);

      // Calculate total size of new files
      const newFilesSize = validFiles.reduce((sum, file) => sum + file.size, 0);

      // Check if total size would exceed limit
      if (existingTotalSize + newFilesSize > MAX_TOTAL_SIZE) {
        const totalMB = Math.round((existingTotalSize + newFilesSize) / (1024 * 1024));
        toast.error(
          `Total attachment size (${totalMB}MB) exceeds the 200MB limit. Please remove some attachments.`,
          { duration: 4000 },
        );
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      // Convert files to base64
      const filePromises = validFiles.map(
        file =>
          new Promise<Attachment>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (): void => {
              const result = reader.result as string;

              // Extract and validate base64 data using regex
              const base64Match = result.match(/^data:([^;]+);base64,(.+)$/);
              if (!base64Match) {
                reject(
                  new Error(`Invalid file format - not a valid data URL for file: ${file.name}`),
                );
                return;
              }

              const [, detectedMimeType, base64Data] = base64Match;

              // Ensure base64 data is not empty
              if (!base64Data) {
                reject(new Error(`Empty file data for file: ${file.name}`));
                return;
              }

              // Validate that detected MIME type matches file.type
              if (detectedMimeType !== file.type) {
                console.warn(
                  `[XyneAI] MIME type mismatch for ${file.name}: file.type=${file.type}, detected=${detectedMimeType}`,
                );
              }

              // Validate base64 format
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
        setSelectedAttachments([...selectedAttachments, ...newAttachments]);

        // Show success message if multiple files were added
        if (newAttachments.length > 1) {
          toast.success(`${newAttachments.length} files attached successfully`, { duration: 2000 });
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Error reading files. Please try again.';
        toast.error(errorMessage, { duration: 3000 });
      }

      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    // Handle removing an attachment
    const handleRemoveAttachment = (attachmentId: string): void => {
      setSelectedAttachments(selectedAttachments.filter(att => att.id !== attachmentId));
    };

    // Helper function to process and add files (shared by file input and drag/drop)
    const handleFilesAdded = useCallback(
      async (files: File[]): Promise<void> => {
        // Filter out dangerous file types (blocklist approach)
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

        // Check individual file size
        const oversizedFiles = validFiles.filter(file => file.size > MAX_INDIVIDUAL_FILE_SIZE);
        if (oversizedFiles.length > 0) {
          const fileNames = oversizedFiles.map(f => f.name).join(', ');
          toast.error(`File(s) too large: ${fileNames}. Maximum file size is 100MB.`, {
            duration: 4000,
          });
          return;
        }

        // Calculate total size of existing attachments
        const existingTotalSize = selectedAttachments.reduce((sum, att) => sum + att.size, 0);

        // Calculate total size of new files
        const newFilesSize = validFiles.reduce((sum, file) => sum + file.size, 0);

        // Check if total size would exceed limit
        if (existingTotalSize + newFilesSize > MAX_TOTAL_SIZE) {
          const totalMB = Math.round((existingTotalSize + newFilesSize) / (1024 * 1024));
          toast.error(
            `Total attachment size (${totalMB}MB) exceeds the 200MB limit. Please remove some attachments.`,
            { duration: 4000 },
          );
          return;
        }

        // Convert files to base64
        const filePromises = validFiles.map(
          file =>
            new Promise<Attachment>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = (): void => {
                const result = reader.result as string;

                // Extract and validate base64 data using regex
                const base64Match = result.match(/^data:([^;]+);base64,(.+)$/);
                if (!base64Match) {
                  reject(
                    new Error(`Invalid file format - not a valid data URL for file: ${file.name}`),
                  );
                  return;
                }

                const [, detectedMimeType, base64Data] = base64Match;

                // Ensure base64 data is not empty
                if (!base64Data) {
                  reject(new Error(`Empty file data for file: ${file.name}`));
                  return;
                }

                // Validate that detected MIME type matches file.type
                if (detectedMimeType !== file.type) {
                  console.warn(
                    `[XyneAI] MIME type mismatch for ${file.name}: file.type=${file.type}, detected=${detectedMimeType}`,
                  );
                }

                // Validate base64 format
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

          // Show success message if multiple files were added
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

    // Expose imperative API for drag and drop
    useImperativeHandle(
      ref,
      () => ({
        addFiles: (files: File[]): void => {
          if (files.length > 0) {
            void handleFilesAdded(files);
          }
        },
        clearContent: (): void => {
          editor?.commands.setContent('');
          setSelectedAttachments([]);
        },
        insertContent: (content: string): void => {
          editor?.commands.insertContent(content);
          editor?.commands.focus();
        },
        isSuggestionOpen: (): boolean => {
          if (!editor) return false;
          const state = editor.state;
          const mentionState = mentionPluginKey.getState(state);
          const channelMentionState = channelMentionPluginKey.getState(state);
          return (
            ((mentionState?.isOpen && mentionState.items.length > 0) ||
              (channelMentionState?.isOpen && channelMentionState.items.length > 0)) ??
            false
          );
        },
        focus: (): void => {
          editor?.commands.focus();
        },
      }),
      [editor, handleFilesAdded],
    );

    // Close research dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent): void => {
        if (
          researchDropdownRef.current &&
          !researchDropdownRef.current.contains(event.target as Node)
        ) {
          setShowResearchDropdown(false);
          setResearchSearchQuery('');
        }
        if (
          collectionDropdownRef.current &&
          !collectionDropdownRef.current.contains(event.target as Node)
        ) {
          setShowCollectionDropdown(false);
          setCollectionSearchQuery('');
        }
      };

      if (showResearchDropdown || showCollectionDropdown) {
        document.addEventListener('mousedown', handleClickOutside);
        return (): void => {
          document.removeEventListener('mousedown', handleClickOutside);
        };
      }
      return undefined;
    }, [showResearchDropdown, showCollectionDropdown]);

    // Notify parent when research context changes
    useEffect(() => {
      onResearchContextChange?.(selectedResearch);
    }, [selectedResearch, onResearchContextChange]);

    // Notify parent when browser context changes
    useEffect(() => {
      onBrowserContextChange?.(browserContext);
    }, [browserContext, onBrowserContextChange]);

    // Filter research items based on search query
    const filteredResearchItems = useMemo(() => {
      const items = researchTab === 'products' ? products : repositories;
      if (!researchSearchQuery.trim()) {
        return items.slice(0, 10);
      }
      const query = researchSearchQuery.toLowerCase();
      return items.filter(item => item.name.toLowerCase().includes(query)).slice(0, 10);
    }, [products, repositories, researchTab, researchSearchQuery]);

    // Handle research button click
    const handleResearchButtonClick = (): void => {
      if (!hasResearchFetched) {
        triggerResearchFetch();
      }
      setShowResearchDropdown(true);
      setResearchSearchQuery('');
      setResearchHighlightedIndex(0);
      setTimeout(() => {
        researchSearchInputRef.current?.focus();
      }, 0);
    };

    // Handle research item selection
    const handleResearchSelect = (
      item: { id: string; name: string },
      type: 'product' | 'repository',
    ): void => {
      setSelectedResearch({
        type,
        id: item.id,
        name: item.name,
      });
      setShowResearchDropdown(false);
      setResearchSearchQuery('');
    };

    // Handle removing research pill
    const handleRemoveResearch = (): void => {
      setSelectedResearch(null);
    };

    // Extract user mentions from the TipTap editor
    const extractUserMentionsFromEditor = useCallback((): Record<string, UserTag> => {
      if (!editor) return {};

      const userTags: Record<string, UserTag> = {};
      const doc = editor.state.doc;

      doc.descendants(node => {
        if (node.type.name === 'mention' && node.attrs['mentionType'] === 'user') {
          const userId = node.attrs['userId'] as string | null;
          const username = node.attrs['username'] as string | null;

          if (userId && username) {
            // Key format: <Username> to match the format used in bot responses
            const key = `<${username}>`;
            userTags[key] = {
              name: username,
              userId: userId,
            };
          }
        }
      });

      return userTags;
    }, [editor]);

    // Extract and notify parent of user tags when editor content changes
    useEffect(() => {
      if (editor && onUserTagsChange) {
        const userTags = extractUserMentionsFromEditor();
        onUserTagsChange(userTags);
      }
    }, [editor, inputValue, extractUserMentionsFromEditor, onUserTagsChange]);

    // Handle research search keyboard navigation
    const handleResearchSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setResearchHighlightedIndex(prev =>
            prev < filteredResearchItems.length - 1 ? prev + 1 : prev,
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setResearchHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (filteredResearchItems[researchHighlightedIndex]) {
            handleResearchSelect(
              filteredResearchItems[researchHighlightedIndex],
              researchTab === 'products' ? 'product' : 'repository',
            );
          }
          break;
        case 'Escape':
          e.preventDefault();
          setShowResearchDropdown(false);
          setResearchSearchQuery('');
          break;
        default:
          break;
      }
    };

    return (
      <div className={`px-4 ${isMobile ? '' : 'mb-4'} relative`}>
        {/* MentionSelector for "@" trigger in editor (user mentions) */}
        <MentionSelector
          editor={editor}
          mentionItems={mentionResults}
          {...(searchMentions && { onMentionSearch: searchMentions })}
        />
        {/* MentionSelector for "#" trigger in editor */}
        <MentionSelector
          editor={editor}
          mentionItems={channelMentionItems}
          triggerChar='#'
          onMentionSearch={handleChannelSearch}
          {...(handleChannelMentionSelect && { onMentionSelect: handleChannelMentionSelect })}
        />

        <div
          className={isVoiceRecording ? 'xyne-voice-border-wrap' : undefined}
          style={isVoiceRecording && isMobile ? { borderRadius: '28px' } : undefined}
        >
          <div
            className={`bg-card border border-input focus-within:border-ring ${isMobile ? 'rounded-[26px]' : 'rounded-2xl'} py-2 px-2 flex flex-col gap-3 transition-colors relative`}
          >
            {/* Selector Buttons and Pills Row */}
            {!isOnboarding && (
              <div
                className='flex items-center gap-2 overflow-x-auto flex-nowrap min-w-0 pb-2'
                style={{
                  scrollbarWidth: 'thin',
                  scrollbarColor: 'hsl(var(--border)) transparent',
                }}
              >
                {/* "/" Button to open unified context modal */}
                <button
                  type='button'
                  onClick={() => onOpenContextModal?.()}
                  className={`flex h-7 py-1 px-2 justify-center items-center gap-2 ${isMobile ? 'rounded-full' : 'rounded-lg'} border border-border hover:bg-muted transition-all duration-200 ease-in-out flex-shrink-0`}
                  aria-label='Add context'
                  title='Add context'
                  data-track-category='XyneAI'
                  data-track-name='OPEN_CONTEXT_MODAL'
                >
                  <span className='text-muted-foreground font-semibold text-sm'>/</span>
                </button>

                {/* Collection Button to open collection selector */}
                <button
                  type='button'
                  onClick={() => {
                    setShowCollectionDropdown(true);
                    setCollectionSearchQuery('');
                  }}
                  className={`flex h-7 py-1 px-2 justify-center items-center gap-2 ${isMobile ? 'rounded-full' : 'rounded-lg'} border border-[#E4E6E7] hover:bg-[#E8EAED] transition-all duration-200 ease-in-out flex-shrink-0`}
                  aria-label='Select collections'
                  title='Select collections'
                  data-track-category='XyneAI'
                  data-track-name='OPEN_COLLECTION_SELECTOR'
                >
                  <BookOpen className='w-4 h-4 text-[#7C3AED]' />
                </button>

                {/* Research Agent Button - only show if no research is selected */}
                {!selectedResearch && (
                  <button
                    type='button'
                    onClick={handleResearchButtonClick}
                    disabled={isResearchLoading}
                    className={`flex h-7 py-1 px-2 justify-center items-center ${isMobile ? 'rounded-full' : 'rounded-lg'} border border-border hover:bg-muted transition-all duration-200 ease-in-out flex-shrink-0 ${isResearchLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    aria-label='Select product or repository for research'
                    title='Deep Research'
                    data-track-category='XyneAI'
                    data-track-name='OPEN_RESEARCH_SELECTOR'
                  >
                    <Search className='w-4 h-4 text-muted-foreground' />
                  </button>
                )}

                {/* Thread Context Pill */}
                {activeThreadInfo && (
                  <div
                    className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-border flex-shrink-0`}
                  >
                    <button
                      type='button'
                      onClick={handleThreadPillClick}
                      className='flex items-center gap-1 cursor-pointer hover:bg-accent transition-colors bg-transparent border-0 p-0'
                      aria-label={`Navigate to thread from ${activeThreadInfo.senderName}`}
                      data-track-category='XYNE_AI'
                      data-track-name='ClickThreadContextPill'
                      data-track-metadata={JSON.stringify({ thread: activeThreadInfo })}
                    >
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[200px] truncate">
                        {activeThreadInfo.senderName} • {activeThreadInfo.previewText}
                      </span>
                    </button>
                    <button
                      type='button'
                      onClick={handleRemoveThreadInfo}
                      className='hover:bg-accent rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label='Remove thread context'
                      data-track-category='XYNE_AI'
                      data-track-name='RemoveThreadContext'
                      data-track-metadata={JSON.stringify({ thread: activeThreadInfo })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                )}

                {/* Canvas Context Pill */}
                {activeCanvasInfo && (
                  <div
                    className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-border flex-shrink-0`}
                  >
                    <button
                      type='button'
                      onClick={handleCanvasPillClick}
                      className='flex items-center gap-1 cursor-pointer hover:bg-accent transition-colors bg-transparent border-0 p-0'
                      aria-label={`Navigate to canvas: ${activeCanvasInfo.title || 'Untitled Canvas'}`}
                      data-track-category='XYNE_AI'
                      data-track-name='ClickCanvasContextPill'
                      data-track-metadata={JSON.stringify({
                        canvasId: activeCanvasInfo.viewAccessId,
                      })}
                    >
                      <FileText className='w-3.5 h-3.5 text-muted-foreground' />
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[200px] truncate">
                        {activeCanvasInfo.title || 'Untitled Canvas'}
                      </span>
                    </button>
                    <button
                      type='button'
                      onClick={handleRemoveCanvasInfo}
                      className='hover:bg-secondary rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label='Remove canvas context'
                      data-track-category='XYNE_AI'
                      data-track-name='RemoveCanvasContext'
                      data-track-metadata={JSON.stringify({
                        canvasId: activeCanvasInfo.viewAccessId,
                      })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                )}

                {/* Selection Context Pills (multiple) */}
                {activeSelectionInfos.map((selection, index) => (
                  <div
                    key={`${selection.canvasViewAccessId}-${index}`}
                    className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-border bg-muted/50 flex-shrink-0`}
                  >
                    <button
                      type='button'
                      onClick={() => handleSelectionPillClick(selection)}
                      className='flex items-center gap-1 cursor-pointer hover:bg-muted transition-colors bg-transparent border-0 p-0'
                      aria-label={`Navigate to canvas with selection: ${selection.preview}`}
                      data-track-category='XYNE_AI'
                      data-track-name='ClickSelectionContextPill'
                      data-track-metadata={JSON.stringify({
                        canvasId: selection.canvasViewAccessId,
                      })}
                    >
                      <FileText className='w-3.5 h-3.5 text-primary' />
                      <span className="text-primary font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[150px] truncate">
                        {selection.preview}
                      </span>
                    </button>
                    <button
                      type='button'
                      onClick={() => handleRemoveSelectionInfo(index)}
                      className='hover:bg-muted rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label='Remove selection context'
                      data-track-category='XYNE_AI'
                      data-track-name='RemoveSelectionContext'
                      data-track-metadata={JSON.stringify({
                        canvasId: selection.canvasViewAccessId,
                      })}
                    >
                      <X className='w-3 h-3 text-primary' />
                    </button>
                  </div>
                ))}

                {/* Browser Context Pill */}
                {browserContext && (
                  <div
                    className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-border bg-muted/50 flex-shrink-0`}
                  >
                    <button
                      type='button'
                      onClick={handleBrowserContextClick}
                      className='flex items-center gap-1 cursor-pointer hover:bg-muted transition-colors bg-transparent border-0 p-0 rounded px-1'
                      aria-label={`Open ${browserContext.domain}`}
                      title={`${browserContext.title}\n${browserContext.url}`}
                      data-track-category='XYNE_AI'
                      data-track-name='ClickBrowserContextPill'
                      data-track-metadata={JSON.stringify({
                        url: browserContext.url,
                        domain: browserContext.domain,
                      })}
                    >
                      <Globe className='w-3.5 h-3.5 text-primary flex-shrink-0' />
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[200px] truncate">
                        {browserContext.text.slice(0, 50)}
                        {browserContext.text.length > 50 ? '...' : ''} • {browserContext.domain}
                      </span>
                    </button>
                    <button
                      type='button'
                      onClick={handleRemoveBrowserContext}
                      className='hover:bg-muted rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label='Remove browser context'
                      data-track-category='XYNE_AI'
                      data-track-name='RemoveBrowserContext'
                      data-track-metadata={JSON.stringify({ url: browserContext.url })}
                    >
                      <X className='w-3 h-3 text-primary' />
                    </button>
                  </div>
                )}

                {/* Channel Pills */}
                {selectedChannels.map(channel => (
                  <div
                    key={channel.id}
                    className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-border flex-shrink-0`}
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        {channel.isPrivate ? (
                          <Lock className='h-3.5 w-3.5 text-muted-foreground' />
                        ) : (
                          <HashIcon />
                        )}
                      </div>
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap">
                        {channel.name}
                      </span>
                    </div>
                    {/* Show X button for all channels */}
                    <button
                      onClick={() => onRemoveChannel?.(channel.id)}
                      className='hover:bg-muted rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label={`Remove ${channel.name}`}
                      data-track-category='XyneAI'
                      data-track-name='REMOVE_CHANNEL'
                      data-track-metadata={JSON.stringify({ channelId: channel.id })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}

                {/* File Scope Pill — narrows Ask AI to a single file (opened from file viewer) */}
                {fileScope && (
                  <div
                    className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-[#E4E6E7] flex-shrink-0`}
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        <FileText className='w-3.5 h-3.5 text-[#7C3AED]' />
                      </div>
                      <span className="text-[#181B1D] font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[160px] truncate">
                        {fileScope.name}
                      </span>
                    </div>
                    {onRemoveFileScope && (
                      <button
                        onClick={onRemoveFileScope}
                        className='hover:bg-blue-200 rounded p-0.5 transition-colors flex-shrink-0'
                        aria-label={`Remove file scope ${fileScope.name}`}
                        data-track-category='XyneAI'
                        data-track-name='REMOVE_FILE_SCOPE'
                      >
                        <X className='w-3 h-3' />
                      </button>
                    )}
                  </div>
                )}

                {/* Collection Pills */}
                {selectedCollections.map(collection => (
                  <div
                    key={collection.id}
                    className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-[#E4E6E7] flex-shrink-0`}
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        <BookOpen className='w-3.5 h-3.5 text-[#7C3AED]' />
                      </div>
                      <span className="text-[#181B1D] font-['Inter'] text-sm font-[450] whitespace-nowrap">
                        {collection.name}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveCollection(collection.id)}
                      className='hover:bg-blue-200 rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label={`Remove ${collection.name}`}
                      data-track-category='XyneAI'
                      data-track-name='REMOVE_COLLECTION'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}

                {/* Research Context Pill */}
                {selectedResearch && (
                  <div
                    className={`flex h-7 py-1 ${isMobile ? 'px-1' : 'px-2'} justify-center items-center ${isMobile ? 'gap-[4px]' : 'gap-2'} rounded-lg border border-border flex-shrink-0`}
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        {selectedResearch.type === 'product' ? (
                          <Package className='w-3.5 h-3.5 text-muted-foreground' />
                        ) : (
                          <Code2 className='w-3.5 h-3.5 text-muted-foreground' />
                        )}
                      </div>
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap">
                        {selectedResearch.name}
                      </span>
                    </div>
                    <button
                      onClick={handleRemoveResearch}
                      className='hover:bg-accent rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label={`Remove ${selectedResearch.name}`}
                      data-track-category='XyneAI'
                      data-track-name='REMOVE_RESEARCH'
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                )}

                {/* Attachment Pills */}
                {selectedAttachments.map(attachment => (
                  <div
                    key={attachment.id}
                    className='flex h-7 py-1 px-2 justify-center items-center gap-2 rounded-lg border border-border bg-muted flex-shrink-0'
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        <FileText className='w-3.5 h-3.5 text-muted-foreground' />
                      </div>
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[120px] truncate">
                        {attachment.name}
                      </span>
                    </div>
                    <button
                      onClick={() => handleRemoveAttachment(attachment.id)}
                      className='hover:bg-muted rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label={`Remove ${attachment.name}`}
                      data-track-category='XyneAI'
                      data-track-name='REMOVE_ATTACHMENT'
                      data-track-metadata={JSON.stringify({ attachmentId: attachment.id })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}

                {/* Ticket Context Pills */}
                {selectedTickets.map(ticket => (
                  <div
                    key={ticket.id}
                    className='flex h-7 py-1 px-2 justify-center items-center gap-2 rounded-lg border border-border bg-card flex-shrink-0'
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        <Ticket className='w-3.5 h-3.5 text-muted-foreground' />
                      </div>
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[120px] truncate">
                        {ticket.xyneId ? `${ticket.xyneId}` : ticket.title}
                      </span>
                    </div>
                    <button
                      onClick={() => onRemoveTicket?.(ticket.id)}
                      className='hover:bg-accent rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label={`Remove ticket ${ticket.title}`}
                      data-track-category='XyneAI'
                      data-track-name='REMOVE_TICKET'
                      data-track-metadata={JSON.stringify({ ticketId: ticket.id })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}

                {/* Canvas Pills */}
                {selectedCanvases.map(canvas => (
                  <div
                    key={canvas.id}
                    className='flex h-7 py-1 px-2 justify-center items-center gap-2 rounded-lg border border-border bg-card flex-shrink-0'
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        <FileText className='w-3.5 h-3.5 text-muted-foreground' />
                      </div>
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[120px] truncate">
                        {canvas.title}
                      </span>
                    </div>
                    <button
                      onClick={() => onRemoveCanvas?.(canvas.id)}
                      className='hover:bg-accent rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label={`Remove canvas ${canvas.title}`}
                      data-track-category='XyneAI'
                      data-track-name='REMOVE_CANVAS'
                      data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}

                {/* Transcript Pills */}
                {selectedTranscripts.map(transcript => (
                  <div
                    key={transcript.id}
                    className='flex h-7 py-1 px-2 justify-center items-center gap-2 rounded-lg border border-border bg-card flex-shrink-0'
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        <Phone className='w-3.5 h-3.5 text-muted-foreground' />
                      </div>
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[120px] truncate">
                        {transcript.title}
                      </span>
                    </div>
                    <button
                      onClick={() => onRemoveTranscript?.(transcript.id)}
                      className='hover:bg-accent rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label={`Remove transcript ${transcript.title}`}
                      data-track-category='XyneAI'
                      data-track-name='REMOVE_TRANSCRIPT'
                      data-track-metadata={JSON.stringify({ transcriptId: transcript.id })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}

                {/* Recording Pills */}
                {selectedRecordings.map(recording => (
                  <div
                    key={recording.id}
                    className='flex h-7 py-1 px-2 justify-center items-center gap-2 rounded-lg border border-border bg-card flex-shrink-0'
                  >
                    <div className='flex items-center gap-1'>
                      <div className='flex-shrink-0'>
                        <Mic className='w-3.5 h-3.5 text-muted-foreground' />
                      </div>
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap max-w-[120px] truncate">
                        {recording.title}
                      </span>
                    </div>
                    <button
                      onClick={() => onRemoveRecording?.(recording.id)}
                      className='hover:bg-accent rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label={`Remove recording ${recording.title}`}
                      data-track-category='XyneAI'
                      data-track-name='REMOVE_RECORDING'
                      data-track-metadata={JSON.stringify({ recordingId: recording.id })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                ))}

                {/* Activity Pills */}
                {selectedActivities.length > 0 && (
                  <div className='flex h-7 py-1 px-2 justify-center items-center gap-2 rounded-lg border border-border bg-background flex-shrink-0'>
                    <div className='flex items-center gap-1'>
                      <span className="text-foreground font-['Inter'] text-sm font-[450] whitespace-nowrap">
                        {selectedActivities.length}{' '}
                        {selectedActivities.length === 1 ? 'activity' : 'activities'}
                      </span>
                    </div>
                    <button
                      onClick={() => onActivitiesChange?.([])}
                      className='hover:bg-accent rounded p-0.5 transition-colors flex-shrink-0'
                      aria-label='Remove all activities'
                      data-track-category='XYNE_AI'
                      data-track-name='RemoveAllActivities'
                      data-track-metadata={JSON.stringify({
                        activityCount: selectedActivities.length,
                      })}
                    >
                      <X className='w-3 h-3' />
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Input Area - Text only */}
            <div className='relative'>
              <EditorContent
                editor={editor}
                className={`bg-transparent outline-none text-foreground p-2 placeholder:text-muted-foreground text-sm font-['Inter'] ${isVoiceRecording && !inputValue ? 'invisible' : ''}`}
              />
              {isVoiceRecording && !inputValue && (
                <div className='absolute inset-0 p-2 pointer-events-none select-none flex items-center gap-3'>
                  <div className='flex items-end gap-[3px]' style={{ height: 18 }}>
                    {([0, 120, 60, 180, 90] as const).map((delay, i) => (
                      <div
                        key={i}
                        className='voice-wave-bar'
                        style={{ height: [10, 18, 14, 18, 10][i], animationDelay: `${delay}ms` }}
                      />
                    ))}
                  </div>
                  <span className='text-[13px] text-muted-foreground'>Listening...</span>
                </div>
              )}
            </div>

            {/* Bottom buttons - Context menu, Web Search Toggle and Submit */}
            {!isOnboarding && (
              <div
                className={`flex items-center ${
                  compactToolbar ? 'flex-wrap gap-2' : 'justify-between gap-2'
                } px-2`}
              >
                <div
                  className={`flex items-center ${
                    compactToolbar ? 'flex-wrap gap-1' : 'gap-2'
                  } min-w-0`}
                >
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type='file'
                    multiple
                    onChange={e => void handleFileChange(e)}
                    className='hidden'
                    aria-label='Upload files'
                  />
                  {/* Attach files button */}
                  <button
                    type='button'
                    onClick={handleAttachFiles}
                    className={`rounded-lg hover:bg-accent transition-colors shrink-0 ${
                      tightToolbar ? 'p-1 -ml-1' : 'p-1.5 -ml-1.5'
                    }`}
                    aria-label='Attach files'
                    title='Attach files'
                    data-track-category='XyneAI'
                    data-track-name='ATTACH_FILES'
                  >
                    <Plus className='w-4 h-4 text-muted-foreground' />
                  </button>

                  {/* Divider line */}
                  {onWebSearchToggle && <div className='h-4 w-px bg-muted' />}

                  {/* Web Search Toggle Button */}
                  {onWebSearchToggle && (
                    <button
                      type='button'
                      onClick={() => {
                        if (webSearchAccessible) {
                          onWebSearchToggle();
                        }
                      }}
                      disabled={!webSearchAccessible}
                      className={`rounded-lg transition-colors shrink-0 ${
                        tightToolbar ? 'p-1' : 'p-1.5'
                      } ${
                        webSearchEnabled
                          ? 'bg-muted text-status-success hover:bg-accent'
                          : 'hover:bg-accent text-muted-foreground'
                      } ${!webSearchAccessible ? 'opacity-50 cursor-not-allowed' : ''}`}
                      aria-label={
                        webSearchAccessible
                          ? webSearchEnabled
                            ? 'Disable web search'
                            : 'Enable web search'
                          : 'Web search not available'
                      }
                      title={
                        webSearchAccessible
                          ? webSearchEnabled
                            ? 'Web search enabled'
                            : 'Enable web search'
                          : "You don't have access to web search."
                      }
                      data-track-category='XyneAI'
                      data-track-name='TOGGLE_WEB_SEARCH'
                      data-track-metadata={JSON.stringify({ enabled: webSearchEnabled })}
                    >
                      <Globe className='w-4 h-4' />
                    </button>
                  )}

                  {/* Divider line */}
                  {onDeepResearchToggle && <div className='h-4 w-px bg-muted' />}

                  {/* Deep Research Toggle Button */}
                  {onDeepResearchToggle && (
                    <button
                      type='button'
                      onClick={() => {
                        if (deepResearchAccessible) {
                          onDeepResearchToggle();
                        }
                      }}
                      disabled={!deepResearchAccessible}
                      className={`rounded-lg transition-colors shrink-0 ${
                        tightToolbar ? 'p-1' : 'p-1.5'
                      } ${
                        deepResearchEnabled
                          ? 'bg-muted text-status-pending hover:bg-accent'
                          : 'hover:bg-accent text-muted-foreground'
                      } ${!deepResearchAccessible ? 'opacity-50 cursor-not-allowed' : ''}`}
                      aria-label={
                        deepResearchAccessible
                          ? deepResearchEnabled
                            ? 'Disable deep research'
                            : 'Enable deep research'
                          : 'Deep research not available'
                      }
                      title={
                        deepResearchAccessible
                          ? deepResearchEnabled
                            ? 'Deep research enabled'
                            : 'Enable deep research'
                          : "You don't have access to deep research."
                      }
                      data-track-category='XyneAI'
                      data-track-name='TOGGLE_DEEP_RESEARCH'
                      data-track-metadata={JSON.stringify({ enabled: deepResearchEnabled })}
                    >
                      <Microscope className='w-4 h-4' />
                    </button>
                  )}

                  {/* Divider line */}
                  {onCreateCanvasToggle && <div className='h-4 w-px bg-border' />}

                  {/* Create Canvas Toggle Button */}
                  {onCreateCanvasToggle && (
                    <button
                      type='button'
                      onClick={onCreateCanvasToggle}
                      className={`rounded-lg transition-colors shrink-0 ${
                        tightToolbar ? 'p-1' : 'p-1.5'
                      } ${
                        createCanvasEnabled
                          ? 'bg-muted text-primary hover:bg-accent'
                          : 'hover:bg-accent text-muted-foreground'
                      }`}
                      aria-label={createCanvasEnabled ? 'Disable create canvas' : 'Create canvas'}
                      title={createCanvasEnabled ? 'Create canvas enabled' : 'Create canvas'}
                      data-track-category='XyneAI'
                      data-track-name='TOGGLE_CREATE_CANVAS'
                      data-track-metadata={JSON.stringify({ enabled: createCanvasEnabled })}
                    >
                      <File className='w-4 h-4' />
                    </button>
                  )}
                  {/* Agent selector */}
                  {onSelectAgent && (
                    <div className='flex items-center shrink-0'>
                      <AgentSelector
                        selectedAgentSlug={selectedAgentSlug}
                        agents={agents}
                        onSelect={onSelectAgent}
                        compact={true}
                        disabled={isStreaming}
                      />
                    </div>
                  )}
                </div>

                {/* Right side: mic + submit */}
                <div className={`flex items-center ${compactToolbar ? 'gap-1 ml-auto' : 'gap-1'}`}>
                  <VoiceInput
                    ref={voiceInputRef}
                    editor={editor}
                    disabled={isStreaming}
                    onStateChange={({ isRecording }) => setIsVoiceRecording(isRecording)}
                  />
                  <button
                    onClick={isStreaming ? onAbort : onSubmit}
                    disabled={!isStreaming && !inputValue.trim()}
                    className={`rounded-full transition-colors shrink-0 ${
                      tightToolbar ? 'p-1.5' : 'p-2'
                    } ${
                      isStreaming
                        ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                        : inputValue.trim()
                          ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                          : 'bg-muted text-muted-foreground cursor-not-allowed'
                    }`}
                    data-track-category='XyneAI'
                    data-track-name={isStreaming ? 'ABORT_MESSAGE' : 'SUBMIT_MESSAGE'}
                  >
                    {isStreaming ? (
                      <StopIcon className='w-2.5 h-2.5' />
                    ) : (
                      <ArrowUp className='w-4 h-4' />
                    )}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Collection Dropdown */}
        {showCollectionDropdown && (
          <div
            ref={collectionDropdownRef}
            className='absolute bottom-full left-4 right-4 mb-2 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden'
          >
            <div className='p-2 border-b border-border bg-muted'>
              {inFolderView && (
                <div className='mb-2 flex items-center gap-1 text-xs text-muted-foreground'>
                  <button
                    type='button'
                    onClick={() => {
                      setCollectionSearchQuery('');
                      setNavStack(prev => prev.slice(0, -1));
                    }}
                    className='flex items-center hover:text-foreground'
                    aria-label='Back'
                    data-track-category='XyneAI'
                    data-track-name='KB_FOLDER_BACK'
                  >
                    <ArrowLeft className='w-3.5 h-3.5' />
                  </button>
                  <span className='truncate'>{navStack.map(n => n.name).join(' / ')}</span>
                </div>
              )}
              <input
                type='text'
                placeholder={inFolderView ? 'Search this folder…' : 'Search collections…'}
                value={collectionSearchQuery}
                onChange={e => setCollectionSearchQuery(e.target.value)}
                className='w-full px-3 py-2 bg-popover text-sm border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-primary'
                data-track-category='XyneAI'
                data-track-name={
                  inFolderView ? 'KB_FOLDER_SEARCH_INPUT' : 'COLLECTION_SEARCH_INPUT'
                }
              />
            </div>
            <div className='max-h-72 overflow-y-auto'>
              {inFolderView ? (
                /* ── Folder view: double-click a folder to open, click a file to scope ── */
                currentSubfolders.length === 0 && currentFiles.length === 0 ? (
                  <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
                    {collectionSearchQuery.trim() ? 'No matches' : 'This folder is empty'}
                  </div>
                ) : (
                  <div className='py-1'>
                    {currentSubfolders.map(folder => (
                      <button
                        key={folder.id}
                        type='button'
                        onDoubleClick={() => openNode(folder)}
                        className='w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-accent'
                        title='Double-click to open'
                        data-track-category='XyneAI'
                        data-track-name='OPEN_KB_FOLDER'
                      >
                        <Folder className='w-4 h-4 text-[#7C3AED] flex-shrink-0' />
                        <span className='flex-1 truncate'>{folder.name}</span>
                        <ChevronRight className='w-4 h-4 text-muted-foreground flex-shrink-0' />
                      </button>
                    ))}
                    {currentFiles.map(file => {
                      const isSelected = fileScope?.id === file.fileId;
                      return (
                        <button
                          key={file.fileId}
                          type='button'
                          onClick={() => handleSelectFile(file)}
                          className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-accent ${
                            isSelected ? 'bg-accent' : ''
                          }`}
                          data-track-category='XyneAI'
                          data-track-name='SELECT_FILE_SCOPE'
                          data-track-metadata={JSON.stringify({ fileId: file.fileId })}
                        >
                          <FileText className='w-4 h-4 text-[#7C3AED] flex-shrink-0' />
                          <span className='flex-1 truncate'>{file.name}</span>
                          {isSelected && <span className='text-xs text-[#7C3AED]'>Selected</span>}
                        </button>
                      );
                    })}
                  </div>
                )
              ) : filteredCollections.length === 0 ? (
                <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
                  {collectionSearchQuery.length === 0
                    ? 'Type to search collections'
                    : 'No collections found'}
                </div>
              ) : (
                /* ── Collection view: click to select · double-click to open ── */
                <div className='py-1'>
                  <div className='px-3 pb-1 text-[11px] text-muted-foreground'>
                    Click to select · double-click to open
                  </div>
                  {filteredCollections.map(collection => {
                    const isSelected = selectedCollections.some(c => c.id === collection.id);
                    return (
                      <button
                        key={collection.id}
                        type='button'
                        onClick={() =>
                          handleCollectionSingleClick({ id: collection.id, name: collection.name })
                        }
                        onDoubleClick={() => openNode({ id: collection.id, name: collection.name })}
                        className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-accent ${
                          isSelected ? 'bg-accent' : ''
                        }`}
                        title='Click to select · double-click to open'
                        data-track-category='XyneAI'
                        data-track-name='SELECT_COLLECTION'
                        data-track-metadata={JSON.stringify({ collectionId: collection.id })}
                      >
                        <BookOpen className='w-4 h-4 text-[#7C3AED] flex-shrink-0' />
                        <span className='flex-1 truncate'>{collection.name}</span>
                        {isSelected && <span className='text-xs text-[#7C3AED]'>Selected</span>}
                        <ChevronRight className='w-4 h-4 text-muted-foreground flex-shrink-0' />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Research Agent Dropdown */}
        {showResearchDropdown && (
          <div
            ref={researchDropdownRef}
            className='absolute bottom-full left-4 right-4 mb-2 bg-popover border border-border rounded-lg shadow-lg z-50 overflow-hidden'
          >
            {/* Tabs */}
            <div className='flex border-b border-border'>
              <button
                type='button'
                onClick={() => {
                  setResearchTab('products');
                  setResearchHighlightedIndex(0);
                }}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  researchTab === 'products'
                    ? 'text-foreground border-b-2 border-foreground bg-muted'
                    : 'text-muted-foreground hover:text-muted-foreground hover:bg-accent'
                }`}
                data-track-category='XyneAI'
                data-track-name='SELECT_PRODUCTS_TAB'
              >
                <Package className='w-4 h-4' />
                Products
              </button>
              <button
                type='button'
                onClick={() => {
                  setResearchTab('repositories');
                  setResearchHighlightedIndex(0);
                }}
                className={`flex-1 px-4 py-2 text-sm font-medium transition-colors flex items-center justify-center gap-2 ${
                  researchTab === 'repositories'
                    ? 'text-foreground border-b-2 border-foreground bg-muted'
                    : 'text-muted-foreground hover:text-muted-foreground hover:bg-accent'
                }`}
                data-track-category='XyneAI'
                data-track-name='SELECT_REPOSITORIES_TAB'
              >
                <Code2 className='w-4 h-4' />
                Repositories
              </button>
            </div>

            {/* Search Input */}
            <div className='p-2 border-b border-border bg-muted'>
              <input
                ref={researchSearchInputRef}
                type='text'
                value={researchSearchQuery}
                onChange={e => {
                  setResearchSearchQuery(e.target.value);
                  setResearchHighlightedIndex(0);
                }}
                onKeyDown={handleResearchSearchKeyDown}
                placeholder={`Search ${researchTab}...`}
                className="w-full bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground border border-border rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent font-['Inter']"
                data-track-category='XyneAI'
                data-track-name='RESEARCH_SEARCH_INPUT'
              />
            </div>

            {/* Items List */}
            <div className='max-h-64 overflow-y-auto'>
              {isResearchLoading ? (
                <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
                  Loading...
                </div>
              ) : filteredResearchItems.length > 0 ? (
                <div className='py-1'>
                  {filteredResearchItems.map((item, index) => (
                    <button
                      key={item.id}
                      data-index={index}
                      tabIndex={index === researchHighlightedIndex ? 0 : -1}
                      onFocus={() => setResearchHighlightedIndex(index)}
                      onClick={() =>
                        handleResearchSelect(
                          item,
                          researchTab === 'products' ? 'product' : 'repository',
                        )
                      }
                      className={`w-full text-left px-3 py-2 hover:bg-accent transition-colors flex items-center gap-2 ${
                        index === researchHighlightedIndex ? 'bg-accent' : ''
                      }`}
                      data-track-category='XyneAI'
                      data-track-name='SELECT_RESEARCH_ITEM'
                      data-track-metadata={JSON.stringify({ itemId: item.id, type: researchTab })}
                    >
                      <div className='flex-shrink-0'>
                        {researchTab === 'products' ? (
                          <Package className='w-4 h-4 text-muted-foreground' />
                        ) : (
                          <Code2 className='w-4 h-4 text-muted-foreground' />
                        )}
                      </div>
                      <div className='flex-1 min-w-0'>
                        <div className="text-sm font-medium text-foreground font-['Inter'] truncate">
                          {item.name}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className='px-3 py-6 text-center text-sm text-muted-foreground'>
                  No {researchTab} found
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    );
  },
);

XyneAIInputBox.displayName = 'XyneAIInputBox';
