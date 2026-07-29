import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  ChevronDown,
  File,
  FolderOpen,
  FolderPlus,
  Loader2,
  Plus,
  Upload,
} from 'lucide-react';
import { useProjectCollections } from '../../components/knowledgeBase/hooks/useProjectCollections';
import { useProjectCollectionMutations } from '../../components/knowledgeBase/hooks/useProjectCollectionMutations';
import { useCollectionMutations } from '../../components/knowledgeBase/hooks/useCollectionMutations';
import { useUploadHandler } from '../../components/knowledgeBase/upload/useUploadHandler';
import { useUploadProgress } from '../../store/useUploadProgressStore';
import {
  CollectionChild,
  CollectionSummary,
  NodeType,
  searchCollectionItems,
  uploadFilesInBatches,
} from '../../services/Knowledge/collectionService';
import CreateCollectionModal from '../../components/knowledgeBase/upload/CreateCollectionModal';
import { ShareCollectionModal } from '../../components/knowledgeBase/upload/ShareCollectionModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { CollectionTreeNode } from '../../components/knowledgeBase/tree/treeTypes';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { ChannelScopeType } from '@xyne/shared';
import { mutators } from '../../zero/mutators';
import { useAllVisibleChannels, useVisibleProjects } from '../../hooks/useChannels';
import { EntryGridV2 } from '../../components/knowledgeBaseV2/components/EntryGridV2';
import { EntryListV2, ColumnDef } from '../../components/knowledgeBaseV2/components/EntryListV2';
import { SearchFieldV2 } from '../../components/knowledgeBaseV2/components/SearchFieldV2';
import { ViewToggleV2, ViewMode } from '../../components/knowledgeBaseV2/components/ViewToggleV2';
import { EmptyPaneV2 } from '../../components/knowledgeBaseV2/components/EmptyPaneV2';
import { CrumbsV2 } from '../../components/knowledgeBaseV2/components/CrumbsV2';
import { SearchResultsV2 } from '../../components/knowledgeBaseV2/components/SearchResultsV2';
import { NameDialogV2 } from '../../components/knowledgeBaseV2/components/NameDialogV2';
import { toast } from 'sonner';
import { useGlobalCollections } from './hooks/useGlobalCollections';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import Tooltip from '../../components/ui/Tooltip';

const KB_COLUMNS: ReadonlyArray<ColumnDef> = [
  { key: 'kind', header: 'Kind', width: '120px' },
  { key: 'size', header: 'Size', width: '120px' },
  { key: 'updated', header: 'Updated', width: '140px' },
];

// Columns shown when listing collections at the root. Drops Size (collections
// don't carry a meaningful aggregate size in this list) in favour of a
// Location column that names the project + channel the collection lives in.
const KB_ROOT_COLUMNS: ReadonlyArray<ColumnDef> = [
  { key: 'location', header: 'Location', width: 'minmax(160px, 1fr)' },
  { key: 'updated', header: 'Updated', width: '140px' },
];

// Mirrors xyne-search /kb: collection id, optional folder id, and free-text
// search live in the URL as search params so back/forward and deep links
// behave the same as in xyne-search.
const SP_COLLECTION = 'cl';
const SP_PARENT = 'parent';
const SP_QUERY = 'q';

export const KnowledgeBaseV2Screen: React.FC = () => {
  const navigate = useNavigate();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const spCollectionId = searchParams.get(SP_COLLECTION);
  const spParentId = searchParams.get(SP_PARENT);
  const spQuery = searchParams.get(SP_QUERY) ?? '';

  const {
    activeCollection,
    currentFolderId,
    setCurrentFolderId,
    setActiveCollection,
    nodes,
    rootChildrenIds,
    isInitialLoading,
  } = useProjectCollections();

  const { user } = useAuth();
  const zero = useZero();
  const allVisibleChannels = useAllVisibleChannels();
  const visibleProjects = useVisibleProjects();
  const globalCollections = useGlobalCollections();
  // V1's mutation hooks — same path TreeSidebar uses. They drive the same
  // Zero mutators we used inline before, but: (a) they clear `activeCollection`
  // when the user deletes the one they're in, and (b) `deleteNode`/`renameNode`
  // invalidate the sorted-children cache so the row order doesn't go stale.
  const { renameCollection, deleteCollection: deleteCollectionMutation } =
    useProjectCollectionMutations();
  const { renameNode, deleteNode } = useCollectionMutations();
  // V1's upload pipeline — initUpload registers a session in the global
  // store and `GlobalUploadProgress` (mounted in AppRoot) renders progress
  // out-of-band. Avoids the in-component setState-per-progress-tick storm
  // that was slowing V2 uploads.
  const { initUpload, createProgressCallback, completeUpload, handleError } = useUploadHandler();
  // Drives the Upload button's spinner without re-rendering on every file
  // progress tick. The selector returns just a boolean — zustand bails out
  // of re-renders when the value is unchanged.
  const isUploadingForThisCollection = useUploadProgress(
    s => s.currentUpload?.isUploading === true && s.currentUpload.collectionId === spCollectionId,
  );

  const [view, setView] = useState<ViewMode>('grid');
  const [query, setQueryState] = useState(spQuery);
  const [dragging, setDragging] = useState(false);
  const [dialog, setDialog] = useState<'folder' | null>(null);
  // Open rename target. Holds the original entry so the dialog can both
  // pre-fill and route the mutation to the right mutator (collection vs.
  // collection_item) after the user submits.
  const [renameTarget, setRenameTarget] = useState<CollectionChild | null>(null);
  // Open share target. ShareCollectionModal reads role+canShare off of the
  // `activeCollection` machine slot, so opening the modal also seeds that
  // slot from the chosen card and we restore it on close.
  const [shareTarget, setShareTarget] = useState<CollectionChild | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  // The folder <input> is conditionally rendered (only when inside a collection),
  // so a mount-time useEffect would miss it. Apply the directory attributes
  // via a ref callback that fires each time the element is attached.
  const setFolderInputRef = useCallback((el: HTMLInputElement | null): void => {
    folderInputRef.current = el;
    if (el) {
      el.setAttribute('webkitdirectory', '');
      el.setAttribute('directory', '');
    }
  }, []);

  // Search
  const [searchHits, setSearchHits] = useState<CollectionChild[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const searchTokenRef = useRef(0);
  const trimmedQuery = query.trim();
  const searching = trimmedQuery.length > 0;

  // No local upload state — V1's `useUploadHandler` registers each upload in
  // a global zustand store and `GlobalUploadProgress` (rendered by AppRoot)
  // displays the progress overlay. Keeping it out of the screen means file
  // progress events don't trigger a screen-wide re-render.

  // ── URL → machine sync ───────────────────────────────────────────────
  // Search params are the source of truth. Push them into the XState
  // machine that drives CollectionTreeDataSync's Zero subscriptions.
  useEffect(() => {
    if (spCollectionId) {
      if (activeCollection?.id !== spCollectionId) {
        setActiveCollection({ id: spCollectionId });
      }
    } else if (activeCollection) {
      setActiveCollection(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spCollectionId]);

  useEffect(() => {
    if (spParentId) {
      if (currentFolderId !== spParentId) setCurrentFolderId(spParentId);
    } else if (currentFolderId) {
      setCurrentFolderId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spParentId]);

  // Keep the local search input in sync with the URL when the URL changes
  // (e.g. browser back/forward).
  useEffect(() => {
    setQueryState(spQuery);
  }, [spQuery]);

  // Once the active collection's data has loaded, fill in its name on the
  // breadcrumb. Falls back to the global collections cache for the deep-link
  // case where the user lands straight on ?cl=<id>.
  useEffect(() => {
    if (!spCollectionId) return;
    if (activeCollection?.id === spCollectionId && activeCollection?.name) return;
    const found = globalCollections.byId(spCollectionId);
    if (found) {
      setActiveCollection({
        id: found.id,
        name: found.name,
        role: found.role,
        canShare: found.canShare,
        ownerId: found.ownerId,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spCollectionId, activeCollection?.id, globalCollections]);

  const collectionId = spCollectionId;
  const isAtRoot = !collectionId;
  const isAtCollectionRoot = !!collectionId && !spParentId;

  // ── Build entries ────────────────────────────────────────────────────
  const entries: CollectionChild[] = useMemo(() => {
    if (isAtRoot) {
      return globalCollections.collections.map(c => ({
        id: c.id,
        name: c.name,
        type: 'FOLDER' as NodeType,
        size: 0,
        updatedAt: new Date().toISOString(),
        ingestionStatus: null,
        mimeType: '',
        parentId: null,
      }));
    }

    const childIds = spParentId ? (nodes[spParentId]?.childrenIds ?? []) : rootChildrenIds;

    return childIds
      .map(id => nodes[id])
      .filter((n): n is CollectionTreeNode => Boolean(n))
      .map(node => ({
        id: node.id,
        name: node.name,
        type: node.type,
        size: node.size ?? 0,
        updatedAt: node.updatedAt,
        ingestionStatus: node.uploadStatus,
        mimeType: node.mimeType ?? '',
        parentId: node.parentId,
      }));
  }, [isAtRoot, globalCollections.collections, spParentId, nodes, rootChildrenIds]);

  const folderCount = entries.filter(e => e.type === 'FOLDER').length;
  const fileCount = entries.filter(e => e.type === 'FILE').length;

  // ── Breadcrumb chain ─────────────────────────────────────────────────
  const chain = useMemo(() => {
    if (!collectionId || !spParentId) return [];
    const result: Array<{ id: string; name: string }> = [];
    let curr: CollectionTreeNode | undefined = nodes[spParentId];
    while (curr) {
      result.unshift({ id: curr.id, name: curr.name });
      if (!curr.parentId) break;
      curr = nodes[curr.parentId];
    }
    return result;
  }, [collectionId, spParentId, nodes]);

  // ── Search ───────────────────────────────────────────────────────────
  // Two regimes:
  //   • Root (`/knowledge-base`, no `cl`): no dedicated KB-wide endpoint, so
  //     we filter the already-loaded collections list client-side by name.
  //   • Inside a collection: hit `searchCollectionItems` for full-text search
  //     across files in that collection.
  useEffect((): (() => void) | undefined => {
    if (!searching) {
      setSearchHits([]);
      setSearchLoading(false);
      setSearchError(null);
      return undefined;
    }
    if (!collectionId) {
      // Client-side filter on the root collections list.
      const q = trimmedQuery.toLowerCase();
      const hits: CollectionChild[] = globalCollections.collections
        .filter(c => c.name.toLowerCase().includes(q))
        .map(c => ({
          id: c.id,
          name: c.name,
          type: 'FOLDER' as NodeType,
          size: 0,
          updatedAt: new Date().toISOString(),
          ingestionStatus: null,
          mimeType: '',
          parentId: null,
        }));
      setSearchHits(hits);
      setSearchLoading(false);
      setSearchError(null);
      return undefined;
    }
    setSearchLoading(true);
    setSearchError(null);
    const myToken = ++searchTokenRef.current;
    const runSearch = async (): Promise<void> => {
      try {
        const results = await searchCollectionItems(collectionId, trimmedQuery);
        if (myToken !== searchTokenRef.current) return;
        setSearchHits(results);
      } catch (err: unknown) {
        if (myToken !== searchTokenRef.current) return;
        const msg = err instanceof Error ? err.message : 'Search failed';
        setSearchError(msg);
        setSearchHits([]);
      } finally {
        if (myToken === searchTokenRef.current) {
          setSearchLoading(false);
        }
      }
    };
    const handle = window.setTimeout((): void => {
      void runSearch();
    }, 160);
    return (): void => {
      window.clearTimeout(handle);
    };
  }, [searching, trimmedQuery, collectionId, globalCollections.collections]);

  // ── URL writers ─────────────────────────────────────────────────────
  const updateParams = useCallback(
    (next: { cl?: string | null; parent?: string | null; q?: string | null }, replace = false) => {
      const sp = new URLSearchParams(searchParams);
      const apply = (key: string, val: string | null | undefined): void => {
        if (val === undefined) return;
        if (val === null || val === '') sp.delete(key);
        else sp.set(key, val);
      };
      apply(SP_COLLECTION, next.cl);
      apply(SP_PARENT, next.parent);
      apply(SP_QUERY, next.q);
      setSearchParams(sp, { replace });
    },
    [searchParams, setSearchParams],
  );

  // ── Navigation helpers ───────────────────────────────────────────────
  const goToCollections = useCallback((): void => {
    updateParams({ cl: null, parent: null, q: null });
  }, [updateParams]);

  const goToCollection = useCallback(
    (clId: string): void => {
      updateParams({ cl: clId, parent: null, q: null });
    },
    [updateParams],
  );

  const goToFolder = useCallback(
    (folderId: string): void => {
      if (!collectionId) return;
      updateParams({ cl: collectionId, parent: folderId, q: null });
    },
    [collectionId, updateParams],
  );

  const goToParent = useCallback(
    (parentId: string | null): void => {
      if (!collectionId) return;
      updateParams({ cl: collectionId, parent: parentId, q: null });
    },
    [collectionId, updateParams],
  );

  const goUp = useCallback((): void => {
    if (!collectionId) return;
    if (!spParentId) {
      goToCollections();
      return;
    }
    const parent = nodes[spParentId]?.parentId ?? null;
    // The tree stores `parentId === collectionId` for top-level folders;
    // mirror /kb's behaviour of treating those as "back to collection root".
    goToParent(parent && parent !== collectionId ? parent : null);
  }, [collectionId, spParentId, nodes, goToCollections, goToParent]);

  const handleCreateSuccess = useCallback(
    (newCollection: CollectionSummary): void => {
      goToCollection(newCollection.id);
    },
    [goToCollection],
  );

  // ── Location resolver ────────────────────────────────────────────────
  // Maps a collection (by id) to "ProjectName · #ChannelName". Used as the
  // grid card caption and the list view's Location column so users can see
  // where each collection lives without drilling into it.
  const channelNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const ch of allVisibleChannels) map.set(ch.id, ch.name);
    return map;
  }, [allVisibleChannels]);

  const projectNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of visibleProjects) map.set(p.id, p.name);
    return map;
  }, [visibleProjects]);

  const locationOf = useCallback(
    (entry: CollectionChild): string => {
      const owning = globalCollections.byId(entry.id);
      if (!owning) return 'Collection';
      const channelName = channelNameById.get(owning.scopeId);
      const projectName = owning.projectId ? projectNameById.get(owning.projectId) : undefined;
      if (channelName && projectName) return `#${channelName} · ${projectName}`;
      if (channelName) return `#${channelName}`;
      return 'Collection';
    },
    [globalCollections, channelNameById, projectNameById],
  );

  // ── Open entry ───────────────────────────────────────────────────────
  const onOpenEntry = useCallback(
    (entry: CollectionChild): void => {
      if (isAtRoot) {
        goToCollection(entry.id);
        return;
      }
      if (entry.type === 'FOLDER') {
        goToFolder(entry.id);
        return;
      }
      if (!collectionId) return;
      // File viewer still reads projectId/channelId from URL path params, so
      // look up the owning channel via the global collections cache and route
      // to the existing nested viewer URL.
      const found = globalCollections.byId(collectionId);
      const projectId = found?.projectId;
      const channelId = found?.scopeId;
      if (projectId && channelId) {
        void navigate(
          `/knowledge-base/${projectId}/${channelId}/${collectionId}/${
            spParentId ?? '_'
          }/${entry.id}`,
        );
      } else {
        toast.error('Could not resolve collection scope');
      }
    },
    [isAtRoot, goToCollection, goToFolder, navigate, collectionId, spParentId, globalCollections],
  );

  // ── Mutations ─────────────────────────────────────────────────────────
  const submitNewFolder = async (name: string): Promise<void> => {
    if (!collectionId) return;
    if (!user) {
      toast.error('You must be logged in');
      return;
    }
    try {
      const id = crypto.randomUUID();
      const timestamp = Date.now();
      const parentId = spParentId ?? collectionId;
      // `.server` doesn't throw on server-side rejection — it resolves with
      // `{ type: 'error', error: { message } }`. Without this check we'd
      // toast "Created" even when the server refused the mutation. Mirrors
      // CreateCollectionModal.tsx:122-144.
      const serverRes = await zero.mutate(
        mutators.collection.createFolder({
          id,
          parentId,
          name,
          timestamp,
        }),
      ).server;
      if (serverRes.type === 'error') {
        toast.error(serverRes.error.message || 'Folder creation failed');
        return;
      }
      toast.success(`Created folder "${name}"`);
      setDialog(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Folder creation failed';
      toast.error(msg);
    }
  };

  const onPickFiles = useCallback((): void => {
    fileInputRef.current?.click();
  }, []);

  const doUpload = useCallback(
    (fileList: FileList | File[]): void => {
      if (!collectionId) {
        toast.error('Open a collection before uploading');
        return;
      }
      const files = Array.from(fileList);
      if (files.length === 0) return;

      // V1 pattern (see UploadModal.tsx:62-103): register the upload in the
      // global store, mint a sessionId for the backend, return immediately so
      // the user can keep navigating. Progress lives in the overlay, not here.
      const collectionName =
        activeCollection?.name ?? globalCollections.byId(collectionId)?.name ?? 'Collection';
      const { uploadId, sessionId, batches } = initUpload(collectionId, collectionName, files);
      const progressCallback = createProgressCallback(uploadId, files, batches);

      void uploadFilesInBatches(
        collectionId,
        files,
        spParentId,
        'rename',
        progressCallback,
        sessionId,
      )
        .then(result => {
          completeUpload(uploadId, {
            totalUploaded: result.totalUploaded,
            totalSkipped: result.totalSkipped,
            totalFailed: result.totalFailed,
          });
        })
        .catch((err: unknown) => {
          handleError(uploadId, err);
        });
    },
    [
      collectionId,
      spParentId,
      activeCollection?.name,
      globalCollections,
      initUpload,
      createProgressCallback,
      completeUpload,
      handleError,
    ],
  );

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    if (e.target.files) {
      doUpload(e.target.files);
    }
    e.target.value = '';
  };

  const onDrop = (e: React.DragEvent<HTMLElement>): void => {
    e.preventDefault();
    setDragging(false);
    doUpload(e.dataTransfer.files);
  };

  // ── Delete ───────────────────────────────────────────────────────────
  // Root branch: collections. Goes through V1's `useProjectCollectionMutations`
  // hook, which fires the same `mutators.collection.deleteCollection` we used
  // inline but also clears `activeCollection` if we happen to be inside the
  // one we just deleted. Adds the OWNER pre-check V1 surfaced in TreeSidebar
  // so non-owners get a clear refusal instead of an opaque server error.
  //
  // Inside-collection branch: folders + files. Goes through `useCollectionMutations.deleteNode`,
  // which fires `mutators.collection.deleteItem` and invalidates the sorted-
  // children cache so the grid/list re-orders correctly after the row drops.
  const onDelete = async (entry: CollectionChild): Promise<void> => {
    if (!user) {
      toast.error('You must be logged in');
      return;
    }
    if (isAtRoot) {
      const owning = globalCollections.byId(entry.id);
      if (owning && owning.role !== 'OWNER') {
        toast.error('Only collection owners can delete collections');
        return;
      }
      const ok = window.confirm(`Delete collection "${entry.name}"? This removes all its files.`);
      if (!ok) return;
      try {
        await deleteCollectionMutation(entry.id);
        toast.success(`Deleted "${entry.name}"`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Delete failed';
        toast.error(msg);
      }
      return;
    }
    if (!collectionId) return;
    const what = entry.type === 'FOLDER' ? 'folder' : 'file';
    const ok = window.confirm(`Delete ${what} "${entry.name}"?`);
    if (!ok) return;
    try {
      await deleteNode(entry.id);
      toast.success(`Deleted "${entry.name}"`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Delete failed';
      toast.error(msg);
    }
  };

  // ── Rename ───────────────────────────────────────────────────────────
  // Inline rename, mirroring xyne-search's InlineRenameField. Clicking the
  // pencil button puts that one entry into edit mode (`editingId === e.id`);
  // the card swaps its name span for an <input>. Enter / blur commits via
  // the appropriate Zero mutator, Escape cancels.
  //
  // Collections (at root) go through `updateCollection`; everything else
  // (folders + files inside a collection) goes through `renameItem`.
  const onRename = (entry: CollectionChild): void => {
    // Renaming a collection is owner-only — matches delete and the new
    // visibility toggle. We block before entering edit mode so non-owners
    // never see an input that would only be rejected on submit.
    if (isAtRoot) {
      const owning = globalCollections.byId(entry.id);
      if (owning && owning.role !== 'OWNER') {
        toast.error('Only the collection owner can rename');
        return;
      }
    }
    setRenameTarget(entry);
  };

  const onRenameCancel = useCallback((): void => {
    setRenameTarget(null);
  }, []);

  const onRenameCommit = useCallback(
    async (entry: CollectionChild, nextName: string): Promise<void> => {
      if (!user) {
        toast.error('You must be logged in');
        setRenameTarget(null);
        return;
      }
      const trimmed = nextName.trim();
      // No-op if blank or unchanged — exit edit mode without firing a mutation.
      if (trimmed === '' || trimmed === entry.name) {
        setRenameTarget(null);
        return;
      }
      try {
        if (isAtRoot) {
          const owning = globalCollections.byId(entry.id);
          if (owning && owning.role !== 'OWNER') {
            toast.error('Only the collection owner can rename');
            return;
          }
          await renameCollection(entry.id, trimmed);
        } else {
          if (!collectionId) {
            setRenameTarget(null);
            return;
          }
          await renameNode(entry.id, trimmed);
        }
        toast.success(`Renamed to "${trimmed}"`);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : 'Rename failed';
        toast.error(msg);
      } finally {
        setRenameTarget(null);
      }
    },
    [user, isAtRoot, collectionId, renameCollection, renameNode, globalCollections],
  );

  // ── Share (root-only) ────────────────────────────────────────────────
  // Matches V1's TreeSidebar gate (`canShare = perm?.canShare ?? isOwner`).
  // The modal validates against `activeCollection.role/canShare` internally,
  // so we seed those on the machine before opening — the URL→machine sync
  // effect only re-runs when spCollectionId changes, so our seed sticks for
  // the lifetime of the modal.
  const onShare = (entry: CollectionChild): void => {
    const owning = globalCollections.byId(entry.id);
    if (!owning) {
      toast.error('Could not resolve collection');
      return;
    }
    if (!owning.canShare) {
      toast.error("You don't have permission to share this collection");
      return;
    }
    setActiveCollection({
      id: owning.id,
      name: owning.name,
      role: owning.role,
      canShare: owning.canShare,
      ownerId: owning.ownerId,
    });
    setShareTarget(entry);
  };

  const closeShare = (): void => {
    setShareTarget(null);
    // Only clear activeCollection if the URL also says "no collection" —
    // i.e. we were at root when share opened. Otherwise let the URL→machine
    // sync own the value.
    if (!spCollectionId) {
      setActiveCollection(null);
    }
  };

  // ── Search field writer ─────────────────────────────────────────────
  const setQuery = (next: string): void => {
    setQueryState(next);
    updateParams({ q: next === '' ? null : next }, /* replace */ true);
  };

  // ── Ask AI ──────────────────────────────────────────────────────────
  // Only rendered when `!isAtRoot` (i.e. a collection is open), so we always
  // have a real collectionId to scope to. The channelId comes from the global
  // collections cache because V2 doesn't carry it in the URL.
  const handleOpenAI = useCallback((): void => {
    if (!collectionId) return;
    const owning = globalCollections.byId(collectionId);
    xyneAIActor.send({
      type: 'OPEN',
      startFreshChat: true,
      kbCollectionId: collectionId,
      kbChannelId: owning?.scopeId ?? null,
    });
  }, [collectionId, globalCollections]);

  // ── Header label ─────────────────────────────────────────────────────
  const rootLabel = isAtRoot
    ? 'Knowledge'
    : (activeCollection?.name ?? globalCollections.byId(collectionId ?? '')?.name ?? 'Collection');

  const loading = isInitialLoading || (isAtRoot && globalCollections.isLoading);

  return (
    <div
      className='flex h-full flex-col ai-page-bg'
      onDragOver={e => {
        e.preventDefault();
        if (collectionId) {
          setDragging(true);
        }
      }}
      onDragLeave={e => {
        if ((e.target as HTMLElement) === e.currentTarget) {
          setDragging(false);
        }
      }}
      onDrop={onDrop}
    >
      <div className='flex flex-wrap items-center justify-between gap-3 border-b border-border ai-page-bg px-5 py-2.5'>
        <div className='flex min-w-0 flex-1 items-center gap-2'>
          <button
            type='button'
            aria-label={
              isAtRoot
                ? 'Back to Ask AI'
                : isAtCollectionRoot
                  ? 'Back to collections'
                  : 'Up one level'
            }
            onClick={() => {
              if (isAtRoot) {
                void navigate(workspaceId ? `/${workspaceId}/ai` : '/ai');
              } else if (collectionId && !spParentId) {
                goToCollections();
              } else {
                goUp();
              }
            }}
            className='grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition hover:bg-secondary hover:text-foreground'
            title={isAtRoot ? 'Back to Ask AI' : isAtCollectionRoot ? 'Back to collections' : 'Up'}
            data-track-category='knowledge-base'
            data-track-name='navigate-up'
          >
            <ArrowLeft className='h-3.5 w-3.5' aria-hidden strokeWidth={1.75} />
          </button>

          {isAtRoot ? (
            <span className='text-[13px] font-medium text-foreground'>Knowledge</span>
          ) : (
            <CrumbsV2
              currentCollectionId={collectionId}
              currentFolderId={spParentId}
              collectionName={rootLabel}
              chain={chain}
              onGoToCollections={goToCollections}
              onGoToParent={parentId => {
                goToParent(parentId);
              }}
              isAtRoot={isAtRoot}
            />
          )}
        </div>

        <div className='flex items-center gap-2'>
          {!isAtRoot && (
            <Tooltip
              content={`Ask AI about this ${spParentId ? 'folder' : 'collection'}`}
              side='bottom'
            >
              <button
                type='button'
                onClick={handleOpenAI}
                data-track-category='knowledge-base'
                data-track-name='kb-open-ai-chat'
                className='inline-flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[12px] text-foreground transition hover:bg-muted'
              >
                <XyneAIStar size={14} />
                Ask AI
              </button>
            </Tooltip>
          )}
          {isAtRoot ? (
            // Collections are channel-scoped, so creation must go through the
            // CreateCollectionModal (it owns the channel picker + name step).
            // The single-field NameDialog can't capture scope, so we wire
            // root creation through the scoped modal.
            <button
              type='button'
              onClick={() => setIsCreateModalOpen(true)}
              className='inline-flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[12px] text-foreground transition hover:bg-muted'
              data-track-category='knowledge-base'
              data-track-name='new-collection'
            >
              <Plus className='h-3.5 w-3.5' strokeWidth={1.75} />
              New collection
            </button>
          ) : (
            <>
              <button
                type='button'
                onClick={() => setDialog('folder')}
                className='inline-flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[12px] text-foreground transition hover:bg-muted'
                data-track-category='knowledge-base'
                data-track-name='new-folder'
              >
                <FolderPlus className='h-3.5 w-3.5' strokeWidth={1.75} />
                New folder
              </button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className='inline-flex h-7 items-center gap-1 rounded-md border border-border bg-secondary px-2 text-[12px] text-foreground transition hover:bg-muted'
                    data-track-category='knowledge-base'
                    data-track-name='open-upload-menu'
                  >
                    {isUploadingForThisCollection ? (
                      <Loader2 className='h-3.5 w-3.5 animate-spin' strokeWidth={1.75} />
                    ) : (
                      <Upload className='h-3.5 w-3.5' strokeWidth={1.75} />
                    )}
                    Upload
                    <ChevronDown className='h-3 w-3' strokeWidth={1.75} />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem onClick={onPickFiles}>
                    <File className='h-4 w-4' strokeWidth={1.75} />
                    Upload files
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => folderInputRef.current?.click()}>
                    <FolderOpen className='h-4 w-4' strokeWidth={1.75} />
                    Upload folder
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <input
                ref={fileInputRef}
                type='file'
                multiple
                className='sr-only'
                onChange={onFileInputChange}
              />
              <input
                ref={setFolderInputRef}
                type='file'
                multiple
                className='sr-only'
                onChange={onFileInputChange}
              />
            </>
          )}
          <ViewToggleV2 value={view} onChange={setView} />
          <SearchFieldV2
            value={query}
            onChange={setQuery}
            className='w-64'
            ariaLabel='Search files'
            placeholder='Search files by name'
          />
        </div>
      </div>

      <main ref={mainRef} className='relative flex-1 overflow-auto px-5 py-5'>
        {dragging ? (
          <div className='pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-background/80 text-[14px] font-medium text-foreground'>
            Drop files to upload
          </div>
        ) : null}
        <div className='mx-auto w-full max-w-7xl'>
          {searching ? (
            <SearchResultsV2
              query={trimmedQuery}
              loading={searchLoading}
              error={searchError}
              hits={searchHits}
              onOpen={onOpenEntry}
            />
          ) : (
            <>
              <p className='mb-3 text-[12px] text-muted-foreground'>
                {loading
                  ? 'Loading...'
                  : isAtRoot
                    ? entries.length === 0
                      ? 'No collections yet'
                      : `${String(entries.length)} collection${entries.length === 1 ? '' : 's'}`
                    : entries.length === 0
                      ? 'This folder is empty'
                      : `${String(folderCount)} folder${folderCount === 1 ? '' : 's'} · ${String(fileCount)} file${fileCount === 1 ? '' : 's'}`}
              </p>

              {entries.length === 0 && !loading && !isUploadingForThisCollection ? (
                <EmptyPaneV2 isRoot={isAtRoot} />
              ) : view === 'grid' ? (
                <EntryGridV2
                  entries={entries}
                  onOpen={onOpenEntry}
                  onDelete={(e): void => {
                    void onDelete(e);
                  }}
                  onRename={onRename}
                  editingId={renameTarget?.id ?? null}
                  onRenameCommit={onRenameCommit}
                  onRenameCancel={onRenameCancel}
                  scrollParentRef={mainRef}
                  {...(isAtRoot ? { folderCaption: locationOf, onShare } : {})}
                />
              ) : (
                <EntryListV2
                  entries={entries}
                  columns={isAtRoot ? [...KB_ROOT_COLUMNS] : [...KB_COLUMNS]}
                  onOpen={onOpenEntry}
                  onDelete={(e): void => {
                    void onDelete(e);
                  }}
                  onRename={onRename}
                  editingId={renameTarget?.id ?? null}
                  onRenameCommit={onRenameCommit}
                  onRenameCancel={onRenameCancel}
                  scrollParentRef={mainRef}
                  {...(isAtRoot
                    ? {
                        onShare,
                        resolveColumnValue: (entry, key): string | undefined =>
                          key === 'location' ? locationOf(entry) : undefined,
                      }
                    : {})}
                />
              )}
            </>
          )}
        </div>
      </main>

      <NameDialogV2
        open={dialog === 'folder'}
        title='New folder'
        description={
          spParentId
            ? 'Adds a folder inside the current folder.'
            : 'Adds a folder at the top of this collection.'
        }
        label='Folder name'
        placeholder='e.g. Drafts'
        helper='Up to 255 characters.'
        submitLabel='Create folder'
        onSubmit={submitNewFolder}
        onClose={() => setDialog(null)}
      />

      <CreateCollectionModal
        isOpen={isCreateModalOpen}
        onClose={() => {
          setIsCreateModalOpen(false);
        }}
        scopeType='CHANNEL'
        channels={allVisibleChannels
          .filter(ch => ch.scopeType === ChannelScopeType.DEFAULT)
          .map(ch => ({ id: ch.id, name: ch.name }))}
        onSuccess={handleCreateSuccess}
      />

      {shareTarget
        ? (() => {
            const owning = globalCollections.byId(shareTarget.id);
            return (
              <ShareCollectionModal
                isOpen
                onClose={closeShare}
                collectionId={shareTarget.id}
                collectionName={shareTarget.name}
                channelId={owning?.scopeId ?? null}
                isPrivate={owning?.isPrivate ?? false}
                canEditVisibility={owning?.role === 'OWNER'}
              />
            );
          })()
        : null}
    </div>
  );
};

export default KnowledgeBaseV2Screen;
