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
import {
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  FileText,
  FolderDefault,
  Notebook,
  PlusDefault,
} from '@xyne/icons';
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
import { ContextPillRow } from './ContextPillRow';
import { RecordingTranscriptModal } from './RecordingTranscriptModal';
import { CONTEXT_PICKER_TOGGLE_ATTR } from './ContextPicker';
import { ModelThinkingSelector } from '../../../AIScreen/ModelThinkingSelector';
import type { ClawAgentModel } from '../../../../services/clawAgentModelsService';
import type { AgentOption } from './AgentSelector';
import {
  ChannelMentionExtension,
  channelMentionPluginKey,
  MentionExtension,
  mentionPluginKey,
} from '../../../ui/TipTapExtensions';
import { MentionSelector } from '../../../ui/Selectors';
import { XyneAIPlusMenu } from './XyneAIPlusMenu';
import type { MentionResult } from '@xyne/shared';
import { usePlatform } from '../../../../hooks/usePlatform';
import type { CollectionSummary } from '../../../../services/Knowledge/collectionService';
import { useCachedQuery } from '../../../../hooks/useCachedQuery';
import { queries } from '../../../../zero/queries';
import type { ThreadInfo, CanvasInfo, SelectionInfo } from '../../../../machines/xyneAIMachine';
import type { VisibleChannel } from '../../../../machines/stateMachine';
import { useNavigate } from 'react-router-dom';
import { xyneAIActor } from '../../../../machines/xyneAIMachine';
import { DANGEROUS_EXTENSIONS } from '@xyne/shared';

import type { UserActivity } from '../../../../hooks/useUserActivity';
import type { UserTag } from '../utils/XyneAITypes';
import { useMentionSearch } from '../../../../hooks/useMentionSearch';
import type {
  SelectedChannel,
  SelectedTicket,
  SelectedCanvas,
  SelectedTranscript,
  SelectedRecording,
  ContextSelections,
} from './ContextPickerPanel';
import type { Channel } from '@xyne/shared';
import { ChannelVisibility } from '@xyne/shared';
import type { DisplaySearchResult } from '../../../../types/search';
import { TabType } from '../../ChatDirectory/ChannelCommandMenu.types';
import { Button } from '../../../ui/Button/Button';

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
  /**
   * Replaces the attached context wholesale — the inline picker toggles items
   * by building the next ContextSelections from current props and pushing it
   * up. Same contract (and typically the same handler) as
   * XyneAIInputSection's onConfirmContext.
   */
  onContextSelectionsChange?: (selections: ContextSelections) => void;
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
  /** Models the selected agent's LiteLLM key can serve. Empty ⇒ picker hides. */
  models?: ClawAgentModel[];
  /** The agent's configured model, shown against the default row. */
  defaultModel?: string | null;
  /** Per-message thinking level for the combined model+thinking menu. */
  thinkingLevel?: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null;
  onSelectThinking?: (v: 'off' | 'minimal' | 'low' | 'medium' | 'high' | null) => void;
  /** Currently pinned model, or null for the agent's default. */
  selectedModel?: string | null;
  onSelectModel?: (model: string | null) => void;
  kbCollectionId?: string | undefined;
  // Bumped by xyneAIMachine on every OPEN with a kbCollectionId. When this
  // changes, the auto-add effect re-attaches the KB collection chip even if
  // the user previously removed it (e.g. clicking Ask AI again from /knowledge-base).
  kbOpenNonce?: number | undefined;
  collectionsList?: CollectionSummary[];
  /** When set, narrows the in-collection drill-down (sub-folders + files) to
   *  what the selected agent is actually scoped to. Same source as the
   *  top-level collections filter — see XyneAISidebar.tsx. When undefined or
   *  empty, no drill-down filtering happens (legacy behavior). */
  agentKbGrants?: Array<{
    collectionId: string;
    fileId: string | null;
    rootCollectionId: string;
  }>;
  /** When Ask AI is opened from a file viewer / picker, scopes retrieval to these files (multi-select). */
  fileScopes?: { id: string; name: string }[];
  /** Replace the selected file set (id = each file's Vespa docId / fileId UUID). */
  onFileScopesChange?: (fileScopes: { id: string; name: string }[]) => void;
  /** Folders scoped in from the collection picker. Sent to claw-auth as a
   *  single 'folder' attached_context pointer per id — NOT expanded to a
   *  recursive file list here (xyneAIControllerV2.ts doesn't do that);
   *  claw-auth resolves it itself, at Vespa-query time, since Vespa's
   *  collectionId filter only ever matches a doc's ROOT collection and
   *  can't filter on a folder id directly. */
  folderScopes?: { id: string; name: string }[];
  onFolderScopesChange?: (folderScopes: { id: string; name: string }[]) => void;
  compactToolbar?: boolean;
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
      onThreadInfoChange,
      onSelectionInfosChange,
      onAttachmentsChange,
      onBrowserContextChange,
      selectedChannels = EMPTY_CHANNELS,
      onRemoveChannel,
      onAddChannel,
      nonDMChannels = EMPTY_NON_DM_CHANNELS,
      onOpenContextModal,
      onContextSelectionsChange,
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
      kbOpenNonce,
      fileScopes = [],
      onFileScopesChange,
      folderScopes = [],
      onFolderScopesChange,
      onUserTagsChange,
      isOnboarding = false,
      selectedAgentSlug = null,
      agents = [],
      onSelectAgent,
      models = [],
      defaultModel = null,
      selectedModel = null,
      onSelectModel,
      thinkingLevel = null,
      onSelectThinking,
      collectionsList: collectionsListProp = [],
      agentKbGrants,
      compactToolbar = false,
    },
    ref,
  ): ReactElement => {
    // Inline context picker rendered in the card above the composer, toggled by
    // the toolbar "/" button.
    const [showContextPicker, setShowContextPicker] = useState(false);

    const collectionDropdownRef = useRef<HTMLDivElement>(null);
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
    const { isMobile, isMac } = usePlatform();
    const navigate = useNavigate();

    // Voice input
    const voiceInputRef = React.useRef<VoiceInputHandle>(null);
    const [isVoiceRecording, setIsVoiceRecording] = useState(false);

    // Get user mentions using the existing hook
    const { results: mentionResults, searchMentions } = useMentionSearch(channelId ?? undefined);

    const [selectedAttachments, setSelectedAttachments] = useState<Attachment[]>([]);

    // Channel search state for # mentions
    const [channelSearchQuery, setChannelSearchQuery] = useState('');

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

    /*
     * Agent-scope drill-down gating
     * ─────────────────────────────
     * When the active agent runs in COLLECTIONS scope (we receive a non-empty
     * `agentKbGrants`), the picker's in-collection drill-down must only show
     * what the agent can actually read. Three rules:
     *
     *   1. A FILE is shown iff
     *        (a) some grant has the matching `fileId`, OR
     *        (b) some WHOLE-collection grant (`fileId === null`) covers the
     *            current folder or any of its ancestors up to the root.
     *
     *   2. A SUB-FOLDER is shown iff
     *        (a) some whole-collection grant covers that sub-folder itself or
     *            any of its ancestors (drilling further would reveal granted
     *            files), OR
     *        (b) some grant (file or collection) has its immediate-parent
     *            `collectionId` equal to the sub-folder OR a descendant of
     *            it (there's a granted thing somewhere underneath).
     *
     *   3. When `agentKbGrants` is undefined/empty, no gating — legacy
     *      behavior (v1, USER scope, agents without KB grants).
     *
     * `allSubfolders` is the FULL sub-folder tree under the current root, so
     * we build a parentId lookup once and reuse it for ancestor walks. Grant
     * matching is restricted to those whose `rootCollectionId` equals the
     * current root to avoid mixing scopes when multiple roots are granted.
     */
    const grantsForCurrentRoot = useMemo(
      () => (agentKbGrants ?? []).filter(g => g.rootCollectionId === rootCollectionId),
      [agentKbGrants, rootCollectionId],
    );
    const subfolderParentById = useMemo(() => {
      const m = new Map<string, string | null>();
      for (const f of allSubfolders ?? []) {
        const node = f as { id: string; parentId?: string | null };
        m.set(node.id, node.parentId ?? null);
      }
      return m;
    }, [allSubfolders]);
    const isAncestorOrSelf = useCallback(
      (maybeAncestor: string, descendant: string): boolean => {
        let cursor: string | null | undefined = descendant;
        while (cursor) {
          if (cursor === maybeAncestor) return true;
          // Root collection has no entry in `subfolderParentById` (the query
          // only returns sub-folders) — stop the walk there.
          cursor = subfolderParentById.has(cursor)
            ? (subfolderParentById.get(cursor) ?? null)
            : null;
        }
        return false;
      },
      [subfolderParentById],
    );
    /** True when a whole-collection grant covers `folderId` OR any of its
     *  ancestors up to and including the root. */
    const folderCoveredByWholeGrant = useCallback(
      (folderId: string): boolean => {
        for (const g of grantsForCurrentRoot) {
          if (g.fileId !== null) continue;
          if (isAncestorOrSelf(g.collectionId, folderId)) return true;
        }
        return false;
      },
      [grantsForCurrentRoot, isAncestorOrSelf],
    );

    const hasAgentGating = grantsForCurrentRoot.length > 0;

    const currentSubfolders = useMemo(() => {
      const all = (allSubfolders ?? [])
        .filter(f => (f as { parentId?: string | null }).parentId === currentFolderId)
        .map(f => ({ id: (f as { id: string }).id, name: (f as { name: string }).name }));
      const searched = !fileQuery ? all : all.filter(f => f.name.toLowerCase().includes(fileQuery));
      if (!hasAgentGating) return searched;
      // Whole-grant coverage of the current folder cascades down — show
      // every sub-folder unchanged.
      if (folderCoveredByWholeGrant(currentFolderId)) return searched;
      return searched.filter(sf => {
        // Whole-grant covers this sub-folder (or an ancestor) — show.
        if (folderCoveredByWholeGrant(sf.id)) return true;
        // Some grant lives at or below this sub-folder — show so the user
        // can keep drilling toward it.
        for (const g of grantsForCurrentRoot) {
          if (isAncestorOrSelf(sf.id, g.collectionId)) return true;
        }
        return false;
      });
    }, [
      allSubfolders,
      currentFolderId,
      fileQuery,
      hasAgentGating,
      folderCoveredByWholeGrant,
      grantsForCurrentRoot,
      isAncestorOrSelf,
    ]);

    const currentFiles = useMemo(() => {
      // CollectionItem has TWO ids:
      //   • `id`     — the row id (cuid). Claw-auth stores THIS in
      //                AgentCollection.fileId when the user picks a file in
      //                the KB picker (see xyne-claw-auth/.../KnowledgeBasePicker.tsx).
      //   • `fileId` — the stable UUID across versions. The dashboard's
      //                fileScope / Vespa lookup uses this downstream.
      // We need both: `rowId` for grant matching, `fileId` for downstream.
      const all = (currentFolderItems ?? [])
        .map(it => ({
          rowId: (it as { id?: string }).id ?? '',
          fileId: (it as { fileId?: string }).fileId ?? '',
          name: (it as { name: string }).name,
        }))
        .filter(it => it.fileId && (!fileQuery || it.name.toLowerCase().includes(fileQuery)));
      if (!hasAgentGating) return all.map(({ fileId, name }) => ({ fileId, name }));
      // Whole-grant coverage of the current folder (or any ancestor) lets
      // every file pass through.
      if (folderCoveredByWholeGrant(currentFolderId)) {
        return all.map(({ fileId, name }) => ({ fileId, name }));
      }
      const allowedRowIds = new Set(
        grantsForCurrentRoot.filter(g => g.fileId !== null).map(g => g.fileId as string),
      );
      return all
        .filter(it => allowedRowIds.has(it.rowId))
        .map(({ fileId, name }) => ({ fileId, name }));
    }, [
      currentFolderItems,
      fileQuery,
      hasAgentGating,
      folderCoveredByWholeGrant,
      currentFolderId,
      grantsForCurrentRoot,
    ]);

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
          // Picking from the picker is an explicit override of the KB auto-add,
          // so suppress further auto-re-adds for this session. Without this, the
          // user can: open Ask AI from /knowledge-base (auto-adds collection A) →
          // pick collection B → remove B → and A snaps back, because the auto-add
          // effect re-fires on selectedCollections.length=0. The Ask AI button
          // still re-attaches A via the kbOpenNonce-driven effect.
          autoAddedCollectionRemoved.current = true;
          // Multi-select: toggle this collection in/out of the set.
          setSelectedCollections(prev => {
            const isSelected = prev.some(c => c.id === collection.id);
            const updated = isSelected
              ? prev.filter(c => c.id !== collection.id)
              : [...prev, { id: collection.id, name: collection.name }];
            onSelectedCollectionsChange?.(updated.map(c => c.id));
            return updated;
          });
        }, 220);
      },
      [onSelectedCollectionsChange],
    );

    // Toggle a file in/out of the multi-select scope. Keeps the dropdown open so
    // several files (across folders) can be picked in one pass. When adding a
    // file, ensure its (root) collection is selected so the KB tool stays enabled
    // + the collection filter applies.
    const handleToggleFile = useCallback(
      (file: { fileId: string; name: string }) => {
        const isSelected = fileScopes.some(f => f.id === file.fileId);
        onFileScopesChange?.(
          isSelected
            ? fileScopes.filter(f => f.id !== file.fileId)
            : [...fileScopes, { id: file.fileId, name: file.name }],
        );
        if (!isSelected) {
          // Same rationale as handleCollectionSingleClick: explicit file pick is
          // user-driven scope, so don't let the KB auto-add bring back the original
          // collection if the user later clears these chips.
          autoAddedCollectionRemoved.current = true;
          const col = navStack[0];
          if (col) {
            setSelectedCollections(prev => {
              if (prev.some(c => c.id === col.id)) return prev;
              const updated = [...prev, col];
              onSelectedCollectionsChange?.(updated.map(c => c.id));
              return updated;
            });
          }
        }
      },
      [fileScopes, onFileScopesChange, navStack, onSelectedCollectionsChange],
    );

    const handleFolderSingleClick = useCallback(
      (folder: { id: string; name: string }) => {
        if (collectionClickTimer.current) return; // a double-click is in progress
        collectionClickTimer.current = setTimeout(() => {
          collectionClickTimer.current = null;
          const isSelected = folderScopes.some(f => f.id === folder.id);
          onFolderScopesChange?.(
            isSelected
              ? folderScopes.filter(f => f.id !== folder.id)
              : [...folderScopes, { id: folder.id, name: folder.name }],
          );
          if (!isSelected) {
            // Same rationale as handleToggleFile: keep the folder's root
            // collection in scope so the backend can resolve the folder id.
            const col = navStack[0];
            if (col) {
              setSelectedCollections(prev => {
                if (prev.some(c => c.id === col.id)) return prev;
                const updated = [...prev, col];
                onSelectedCollectionsChange?.(updated.map(c => c.id));
                return updated;
              });
            }
          }
        }, 220);
      },
      [folderScopes, navStack, onFolderScopesChange, onSelectedCollectionsChange],
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

          // Cmd+Shift+Option+/ (Mac) or Ctrl+Shift+Alt+/ (others) → toggle the
          // inline context picker. Matched on event.code — with Shift/Option
          // held, event.key is whatever character the layout produces ('?',
          // '¿', …), but the physical slash key is always code 'Slash'.
          // Opening moves focus into the picker's own search field (it
          // autofocuses), so continued typing filters there, not here.
          if (
            event.code === 'Slash' &&
            event.shiftKey &&
            event.altKey &&
            (event.ctrlKey || event.metaKey)
          ) {
            event.preventDefault();
            setShowContextPicker(prev => !prev);
            return true;
          }

          // Escape closes the inline picker (when focus is still in the editor)
          // or the legacy context modal.
          if (event.key === 'Escape' && showContextPicker) {
            event.preventDefault();
            setShowContextPicker(false);
            return true;
          }
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
        toast.error(`File(s) too large: ${fileNames}. Maximum file size is 10MB.`, {
          duration: 4000,
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        return;
      }

      // Check attachment count
      if (selectedAttachments.length + validFiles.length > MAX_FILE_COUNT) {
        toast.error(
          `You can attach up to ${MAX_FILE_COUNT} files per conversation. Remove some attachments before adding more.`,
          { duration: 4000 },
        );
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
          `Total attachment size (${totalMB}MB) exceeds the 25MB limit. Please remove some attachments.`,
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
                logger.warn(LogEvent.FRONTEND_ERROR, {
                  type: 'migrated_console_warn',
                  message: String(
                    `[XyneAI] MIME type mismatch for ${file.name}: file.type=${file.type}, detected=${detectedMimeType}`,
                  ),
                });
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
          toast.error(`File(s) too large: ${fileNames}. Maximum file size is 10MB.`, {
            duration: 4000,
          });
          return;
        }

        // Check attachment count
        if (selectedAttachments.length + validFiles.length > MAX_FILE_COUNT) {
          toast.error(
            `You can attach up to ${MAX_FILE_COUNT} files per conversation. Remove some attachments before adding more.`,
            { duration: 4000 },
          );
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
            `Total attachment size (${totalMB}MB) exceeds the 25MB limit. Please remove some attachments.`,
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
                  logger.warn(LogEvent.FRONTEND_ERROR, {
                    type: 'migrated_console_warn',
                    message: String(
                      `[XyneAI] MIME type mismatch for ${file.name}: file.type=${file.type}, detected=${detectedMimeType}`,
                    ),
                  });
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

    // Close collection dropdown when clicking outside
    useEffect(() => {
      const handleClickOutside = (event: MouseEvent): void => {
        if (
          collectionDropdownRef.current &&
          !collectionDropdownRef.current.contains(event.target as Node)
        ) {
          setShowCollectionDropdown(false);
          setCollectionSearchQuery('');
        }
      };

      if (showCollectionDropdown) {
        document.addEventListener('mousedown', handleClickOutside);
        return (): void => {
          document.removeEventListener('mousedown', handleClickOutside);
        };
      }
      return undefined;
    }, [showCollectionDropdown]);

    // Notify parent when browser context changes
    useEffect(() => {
      onBrowserContextChange?.(browserContext);
    }, [browserContext, onBrowserContextChange]);

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

    // ── Inline picker → attached context ─────────────────────────────────
    // Toggles rebuild the full ContextSelections from current props and push
    // it up through onContextSelectionsChange (the sidebar's confirm handler),
    // so the pills, the picker's check badges, and submit all read one source.
    // Caps mirror ContextPickerPanel: 5 channels, 5 other items.
    const currentSelections = (): ContextSelections => ({
      channels: selectedChannels,
      tickets: selectedTickets,
      canvases: selectedCanvases,
      transcripts: selectedTranscripts,
      recordings: selectedRecordings,
    });

    const handlePickerToggleChannel = (channel: Channel, displayName: string): void => {
      const next = currentSelections();
      if (selectedChannels.some(c => c.id === channel.id)) {
        next.channels = selectedChannels.filter(c => c.id !== channel.id);
      } else {
        if (selectedChannels.length >= 5) {
          toast.error('Maximum 5 channels can be selected', { duration: 2000 });
          return;
        }
        next.channels = [
          ...selectedChannels,
          {
            id: channel.id,
            name: displayName,
            isPrivate: channel.visibility === ChannelVisibility.PRIVATE,
          },
        ];
      }
      onContextSelectionsChange?.(next);
    };

    const handlePickerToggleResult = (result: DisplaySearchResult, tab: TabType): void => {
      // Same raw-id + title conventions as ContextPickerPanel: attachment id
      // wins for dedupe, and Vespa's <hi> highlight tags never reach a pill.
      const rawId = result.searchContext?.attachmentId ?? result.id;
      const title = (result.title || '').replace(/<[^>]*>/g, '');
      const next = currentSelections();
      // Chat location the transcript lives at — what the pill navigates to.
      const pillLocation = {
        ...(result.searchContext?.channelId ? { channelId: result.searchContext.channelId } : {}),
        ...(result.searchContext?.conversationId
          ? { conversationId: result.searchContext.conversationId }
          : {}),
      };

      const toggle = <T extends { id: string }>(list: T[], make: () => T): T[] | null => {
        if (list.some(item => item.id === rawId)) return list.filter(item => item.id !== rawId);
        const nonChannelCount =
          selectedTickets.length +
          selectedCanvases.length +
          selectedTranscripts.length +
          selectedRecordings.length;
        if (nonChannelCount >= 20) {
          toast.error('Maximum 20 context items can be selected', { duration: 2000 });
          return null;
        }
        return [...list, make()];
      };

      if (tab === TabType.TICKETS) {
        const xyneId = result.searchContext?.xyneId;
        const status = result.searchContext?.ticketStatus;
        const toggled = toggle(selectedTickets, () => ({
          id: rawId,
          title,
          ...(xyneId ? { xyneId } : {}),
          ...(status ? { status } : {}),
        }));
        if (!toggled) return;
        next.tickets = toggled;
      } else if (tab === TabType.CANVAS) {
        const toggled = toggle(selectedCanvases, () => ({
          id: rawId,
          title,
          ...(result.id ? { canvasId: result.id } : {}),
        }));
        if (!toggled) return;
        next.canvases = toggled;
      } else if (tab === TabType.CALL) {
        const toggled = toggle(selectedTranscripts, () => ({ id: rawId, title, ...pillLocation }));
        if (!toggled) return;
        next.transcripts = toggled;
      } else if (tab === TabType.RECORDING) {
        const toggled = toggle(selectedRecordings, () => ({
          id: rawId,
          title,
          ...pillLocation,
          ...(result.searchContext?.externalId
            ? { externalId: result.searchContext.externalId }
            : {}),
        }));
        if (!toggled) return;
        next.recordings = toggled;
      } else {
        return;
      }
      onContextSelectionsChange?.(next);
    };

    const closeContextPicker = (reason: 'key' | 'outside' = 'key'): void => {
      setShowContextPicker(false);
      // Only steal focus back on a keyboard dismissal — after an outside click
      // focus already belongs wherever the user clicked.
      if (reason === 'key') editor?.commands.focus();
    };

    // Gutter lives on the composer-container in the parent (see the Figma
    // frame: composer-container owns px/pb, composer is w-full).
    return (
      <div className='relative w-full'>
        <ContextPillRow
          isOnboarding={isOnboarding}
          isMobile={isMobile}
          showContextPicker={showContextPicker}
          onCloseContextPicker={closeContextPicker}
          onPickerToggleChannel={handlePickerToggleChannel}
          onPickerToggleResult={handlePickerToggleResult}
          threadInfo={activeThreadInfo}
          onThreadClick={handleThreadPillClick}
          onRemoveThread={handleRemoveThreadInfo}
          canvasInfo={activeCanvasInfo}
          onCanvasInfoClick={handleCanvasPillClick}
          onRemoveCanvasInfo={handleRemoveCanvasInfo}
          selectionInfos={activeSelectionInfos}
          onSelectionClick={handleSelectionPillClick}
          onRemoveSelection={handleRemoveSelectionInfo}
          browserContext={browserContext}
          onBrowserContextClick={handleBrowserContextClick}
          onRemoveBrowserContext={handleRemoveBrowserContext}
          channels={selectedChannels}
          {...(onRemoveChannel && { onRemoveChannel })}
          fileScopes={fileScopes}
          {...(onFileScopesChange && { onFileScopesChange })}
          folderScopes={folderScopes}
          {...(onFolderScopesChange && { onFolderScopesChange })}
          collections={selectedCollections}
          onRemoveCollection={handleRemoveCollection}
          attachments={selectedAttachments}
          onRemoveAttachment={handleRemoveAttachment}
          tickets={selectedTickets}
          {...(onRemoveTicket && { onRemoveTicket })}
          canvases={selectedCanvases}
          {...(onRemoveCanvas && { onRemoveCanvas })}
          onCanvasClick={handleCanvasContextClick}
          transcripts={selectedTranscripts}
          {...(onRemoveTranscript && { onRemoveTranscript })}
          onTranscriptClick={handleTranscriptContextClick}
          recordings={selectedRecordings}
          {...(onRemoveRecording && { onRemoveRecording })}
          onRecordingClick={handleRecordingContextClick}
          activities={selectedActivities}
          {...(onActivitiesChange && { onActivitiesChange })}
        />

        <RecordingTranscriptModal
          callId={transcriptCallId}
          onClose={() => setTranscriptCallId(null)}
        />

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
          {/* Chrome mirrors the channel composer (ui/InputBox/InputBox.tsx) so
              the two inputs read as the same control. Focus is CSS-driven here
              (focus-within) rather than the channel composer's isFocused state
              — same visual, one less render per focus change. */}
          <div
            className={`
            overflow-hidden transition-all flex flex-col relative bg-clip-padding
            ${isMobile ? 'bg-background rounded-[26px] text-foreground shadow-sm' : 'bg-background rounded-2xl border border-chat-composer-border focus-within:border-chat-composer-border-active text-foreground shadow-none'}
          `}
          >
            {/* Input Area - Text only */}
            <div className='relative pt-1 pb-1 px-3'>
              {/* `[&_p.is-editor-empty:before]:hidden` kills the Placeholder
                  extension's pseudo-element. global.css styles it as a
                  `float:left; height:0` box, so it paints at the TOP of the
                  line box while the caret sits centred in the 24px leading —
                  they never line up. The channel composer solves it the same
                  way: hide the pseudo, overlay a real flex-centred div. */}
              <EditorContent
                editor={editor}
                className={`chat-input-field bg-transparent outline-none text-foreground text-sm leading-6 font-['Inter'] [&_p.is-editor-empty:before]:hidden ${isVoiceRecording && !inputValue ? 'invisible' : ''}`}
              />
              {!inputValue &&
                !isVoiceRecording &&
                !editor?.isActive('codeBlock') &&
                !editor?.isActive('bulletList') &&
                !editor?.isActive('orderedList') &&
                !editor?.isActive('blockquote') && (
                  <div className='absolute inset-0 px-3 py-2 flex items-center h-fit my-auto pointer-events-none select-none text-muted-foreground text-[14px] leading-6'>
                    Ask Xyne AI
                  </div>
                )}
              {isVoiceRecording && !inputValue && (
                <div className='absolute inset-0 px-3 py-2 pointer-events-none select-none flex items-center gap-3'>
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
                } px-2 pb-2 pt-1`}
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
                  {/* "+" menu — attach, collections, canvas, web/deep search */}
                  <XyneAIPlusMenu
                    onAttachFiles={handleAttachFiles}
                    onOpenCollections={() => {
                      setShowCollectionDropdown(true);
                      setCollectionSearchQuery('');
                    }}
                    {...(onCreateCanvasToggle && { onCreateCanvasToggle })}
                    createCanvasEnabled={createCanvasEnabled}
                    {...(onWebSearchToggle && { onWebSearchToggle })}
                    webSearchEnabled={webSearchEnabled}
                    webSearchAccessible={webSearchAccessible}
                    {...(onDeepResearchToggle && { onDeepResearchToggle })}
                    deepResearchEnabled={deepResearchEnabled}
                    deepResearchAccessible={deepResearchAccessible}
                  >
                    <button
                      type='button'
                      className={`flex items-center justify-center rounded hover:bg-accent transition-all duration-200 ease-in-out shrink-0 p-1.5`}
                      aria-label='Add to conversation'
                      title='Add to conversation'
                      data-track-category='XyneAI'
                      data-track-name='OPEN_PLUS_MENU'
                    >
                      <PlusDefault className='w-4 h-4 text-muted-foreground' />
                    </button>
                  </XyneAIPlusMenu>

                  {/* "/" Button toggles the inline context picker in the card
                      above. The ⌘/ shortcut still opens the old modal. */}
                  <button
                    type='button'
                    onClick={() => setShowContextPicker(prev => !prev)}
                    className={`flex items-center justify-center rounded hover:bg-accent transition-all duration-200 ease-in-out shrink-0 p-1.5`}
                    aria-label='Add context'
                    title={`Add context (${isMac ? '⌘⇧⌥' : 'Ctrl+Shift+Alt+'}/)`}
                    // Spared by the picker's outside-click handler, so this
                    // button toggles instead of close-then-reopen.
                    {...{ [CONTEXT_PICKER_TOGGLE_ATTR]: '' }}
                    data-track-category='XyneAI'
                    data-track-name='OPEN_CONTEXT_MODAL'
                  >
                    <span className='w-4 h-4 leading-4 text-center text-muted-foreground font-semibold text-sm'>
                      /
                    </span>
                  </button>

                  {/* Agent selector */}
                  {onSelectAgent && (
                    <div className='flex items-center shrink-0'>
                      <AgentSelector
                        selectedAgentSlug={selectedAgentSlug}
                        agents={agents}
                        onSelect={onSelectAgent}
                        compact={true}
                      />
                    </div>
                  )}
                  {/* Combined model + thinking menu — same component as the
                      /ai composer (Recommended row, search, Thinking flyout). */}
                  {onSelectModel && (
                    <div className='flex items-center shrink-0'>
                      <ModelThinkingSelector
                        models={models}
                        defaultModel={defaultModel}
                        selectedModel={selectedModel}
                        onSelectModel={onSelectModel}
                        thinkingLevel={thinkingLevel}
                        onSelectThinking={onSelectThinking ?? (() => {})}
                        disabled={false}
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
                  <Button
                    variant='ghost'
                    onClick={isStreaming ? onAbort : onSubmit}
                    trackId={isStreaming ? 'abort_message' : 'submit_message'}
                    disabled={!isStreaming && !inputValue.trim()}
                    className={`rounded-full transition-colors shrink-0 p-2 ${
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
                  </Button>
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
                    {currentSubfolders.map(folder => {
                      const isSelected = folderScopes.some(f => f.id === folder.id);
                      return (
                        <button
                          key={folder.id}
                          type='button'
                          onClick={() => handleFolderSingleClick(folder)}
                          onDoubleClick={() => openNode(folder)}
                          className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-accent ${
                            isSelected ? 'bg-accent' : ''
                          }`}
                          title='Click to select · double-click to open'
                          data-track-category='XyneAI'
                          data-track-name='SELECT_KB_FOLDER'
                        >
                          <FolderDefault className='w-4 h-4 text-claw-ai-fg flex-shrink-0' />
                          <span className='flex-1 truncate'>{folder.name}</span>
                          {isSelected && <span className='text-xs text-claw-ai-fg'>Selected</span>}
                          <ChevronRight className='w-4 h-4 text-muted-foreground flex-shrink-0' />
                        </button>
                      );
                    })}
                    {currentFiles.map(file => {
                      const isSelected = fileScopes.some(f => f.id === file.fileId);
                      return (
                        <button
                          key={file.fileId}
                          type='button'
                          onClick={() => handleToggleFile(file)}
                          className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 hover:bg-accent ${
                            isSelected ? 'bg-accent' : ''
                          }`}
                          data-track-category='XyneAI'
                          data-track-name='SELECT_FILE_SCOPE'
                          data-track-metadata={JSON.stringify({ fileId: file.fileId })}
                        >
                          <FileText className='w-4 h-4 text-claw-ai-fg flex-shrink-0' />
                          <span className='flex-1 truncate'>{file.name}</span>
                          {isSelected && <span className='text-xs text-claw-ai-fg'>Selected</span>}
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
                        <Notebook className='w-4 h-4 text-claw-ai-fg flex-shrink-0' />
                        <span className='flex-1 truncate'>{collection.name}</span>
                        {isSelected && <span className='text-xs text-claw-ai-fg'>Selected</span>}
                        <ChevronRight className='w-4 h-4 text-muted-foreground flex-shrink-0' />
                      </button>
                    );
                  })}
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
