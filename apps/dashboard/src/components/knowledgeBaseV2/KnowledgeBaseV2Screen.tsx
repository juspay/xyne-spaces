import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { cn } from '../../utils/classNames';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  File,
  Folder,
  FolderOpen,
  FolderPlus,
  Link2,
  Loader2,
  Plus,
  X,
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
  uploadFilesInBatches,
} from '../../services/Knowledge/collectionService';
import CreateCollectionModal from '../../components/knowledgeBase/upload/CreateCollectionModal';
import { ShareCollectionModal } from '../../components/knowledgeBase/upload/ShareCollectionModal';
import { ShareLinkModal } from '../../components/knowledgeBaseV2/components/ShareLinkModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu';
import { CollectionTreeNode } from '../../components/knowledgeBase/tree/treeTypes';
import { useAuth } from '../../hooks/useAuth';
import { useZero } from '../../hooks/useZero';
import { ChannelScopeType, IngestionStatus } from '@xyne/shared';
import { useCachedQuery } from '../../hooks/useCachedQuery';
import { queries } from '../../zero/queries';
import { mutators } from '../../zero/mutators';
import { useAllVisibleChannels, useVisibleProjects } from '../../hooks/useChannels';
import { EntryGridV2 } from '../../components/knowledgeBaseV2/components/EntryGridV2';
import { EntryListV2, ColumnDef } from '../../components/knowledgeBaseV2/components/EntryListV2';
import {
  CollectionStatusDrawer,
  StatusDrawerTarget,
} from '../../components/knowledgeBaseV2/components/CollectionStatusDrawer';
import { AddDriveLinkModal } from '../../components/knowledgeBaseV2/components/AddDriveLinkModal';
import { DriveConnectDialog } from '../../components/knowledgeBaseV2/components/DriveConnectDialog';
import {
  runDriveImport,
  takePendingDriveImport,
} from '../../components/knowledgeBaseV2/utils/driveImport';
import { ViewToggleV2, ViewMode } from '../../components/knowledgeBaseV2/components/ViewToggleV2';
import { EmptyPaneV2 } from '../../components/knowledgeBaseV2/components/EmptyPaneV2';
import { StatusBadgeV2 } from '../../components/knowledgeBaseV2/components/StatusBadgeV2';
import { CrumbsV2 } from '../../components/knowledgeBaseV2/components/CrumbsV2';
import { resolveKbBasePath } from './utils/kbRoutePaths';
import { NameDialogV2 } from '../../components/knowledgeBaseV2/components/NameDialogV2';
import { toast } from 'sonner';
import { useGlobalCollections } from './hooks/useGlobalCollections';
import { xyneAIActor } from '../../machines/xyneAIMachine';
import { XyneAIStar } from '../../components/icons/xyne-ai';
import Tooltip from '../../components/ui/Tooltip';

const KB_COLUMNS: ReadonlyArray<ColumnDef> = [
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

type StatusFilterValue = 'ALL' | 'PENDING' | 'PROCESSING' | 'FAILED' | 'COMPLETED';

// Collapses a raw ingestionStatus (null/NONE/COMPLETED all mean "nothing left
// to do") down to the four buckets the filter dropdown offers.
function normalizeStatusFilter(
  status: IngestionStatus | string | null | undefined,
): StatusFilterValue {
  const s = (status ?? '').toUpperCase();
  if (s === 'PENDING' || s === 'PROCESSING' || s === 'FAILED') return s;
  return 'COMPLETED';
}

const STATUS_FILTER_OPTIONS: ReadonlyArray<{ value: StatusFilterValue; label: string }> = [
  { value: 'PROCESSING', label: 'Processing' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'FAILED', label: 'Failed' },
  { value: 'COMPLETED', label: 'Ready' },
];

// Same icon language as CollectionStatusBadgeV2 / FileFailedBadgeV2, just
// inline-sized for a dropdown row instead of a circular overlay badge.
function statusFilterIcon(value: StatusFilterValue): React.ReactElement {
  switch (value) {
    case 'PROCESSING':
      return (
        <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin text-amber-500' strokeWidth={2} />
      );
    case 'PENDING':
      return (
        <Loader2 className='h-3.5 w-3.5 shrink-0 animate-spin text-gray-400' strokeWidth={2} />
      );
    case 'FAILED':
      return <AlertCircle className='h-3.5 w-3.5 shrink-0 text-red-500' strokeWidth={2} />;
    default:
      return <CheckCircle2 className='h-3.5 w-3.5 shrink-0 text-green-600' strokeWidth={2} />;
  }
}

// 'FOLDER' for folders, else the uppercased file extension (e.g. 'MD', 'PDF') —
// same bucketing EntryListV2's Kind column already uses for files.
function typeFilterValueFor(entry: CollectionChild): string {
  if (entry.type === 'FOLDER') return 'FOLDER';
  const ext = entry.name.split('.').pop()?.toUpperCase();
  return ext || 'FILE';
}

function typeFilterLabelFor(value: string): string {
  return value === 'FOLDER' ? 'Folders' : value;
}

// Same file-type color language as the grid/list icons (StatusBadgeV2) —
// `file.<ext>` is a throwaway name, only its extension is ever read.
function typeFilterIcon(value: string): React.ReactElement {
  if (value === 'FOLDER') {
    return <Folder className='h-4 w-4 shrink-0 text-muted-foreground' strokeWidth={1.75} />;
  }
  return <StatusBadgeV2 name={`file.${value.toLowerCase()}`} size='sm' />;
}

// Mirrors xyne-search /kb: collection id and optional folder id live in the
// URL as search params so back/forward and deep links behave the same as in
// xyne-search.
const SP_COLLECTION = 'cl';
const SP_PARENT = 'parent';

/** A folder id + all descendant folder ids (used to scope a file listing to a subtree). */
function collectSubtreeFolderIds(
  rootId: string,
  nodes: Record<string, CollectionTreeNode>,
): string[] {
  const ids = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    for (const childId of nodes[cur]?.childrenIds ?? []) {
      if (nodes[childId]?.type === 'FOLDER' && !ids.has(childId)) {
        ids.add(childId);
        stack.push(childId);
      }
    }
  }
  return [...ids];
}

export const KnowledgeBaseV2Screen: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  // This screen is a leaf under both /knowledge-base and /ai/knowledge; the
  // file viewer route it navigates to lives at the same prefix as whichever
  // of the two it's currently mounted under.
  const browseBasePath = useMemo(() => resolveKbBasePath(location.pathname), [location.pathname]);
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const spCollectionId = searchParams.get(SP_COLLECTION);
  const spParentId = searchParams.get(SP_PARENT);

  // Resume a Drive import after the full-page "Connect Google Drive" OAuth redirect.
  // The backend returns us to this KB URL with ?driveOAuth=success|driveOAuthError;
  // we clear those params and re-run the import that was stashed before the redirect.
  const handledDriveOAuthReturn = useRef(false);
  useEffect(() => {
    if (handledDriveOAuthReturn.current) return;
    const success = searchParams.get('driveOAuth');
    const errorCode = searchParams.get('driveOAuthError');
    if (!success && !errorCode) return;
    handledDriveOAuthReturn.current = true;

    const next = new URLSearchParams(searchParams);
    next.delete('driveOAuth');
    next.delete('driveOAuthError');
    setSearchParams(next, { replace: true });

    const pending = takePendingDriveImport();
    if (errorCode) {
      toast.error('Google Drive connection failed. Please try again.');
      return;
    }
    if (pending) {
      // Post-connect resume: don't offer connect again (avoid a loop) — a token
      // now exists, so private files import; if it still fails, show the error.
      runDriveImport(pending, { allowConnect: false });
    } else {
      toast.success('Google Drive connected.');
    }
  }, [searchParams, setSearchParams]);

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

  const [view, setView] = useState<ViewMode>('list');
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
  // Open share target for a regular folder/file (copy-link-only dialog —
  // no ACL of its own, see ShareLinkModal). Distinct from `shareTarget`
  // (collections), which drives the full access-management dialog.
  const [linkShareTarget, setLinkShareTarget] = useState<CollectionChild | null>(null);
  // Collection whose ingestion status drawer is open (root view only).
  const [statusFor, setStatusFor] = useState<StatusDrawerTarget | null>(null);
  // "Add from Google Drive link" modal (inside a collection).
  const [driveLinkOpen, setDriveLinkOpen] = useState(false);
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
  // Write access to an open collection's contents (upload, new folder,
  // rename, delete) requires being a collaborator — owner or explicit
  // EDITOR grant. Public collections are read-only by default; sub-folders
  // have no ACL of their own, so this is depth-independent.
  const canEdit = activeCollection?.role === 'EDITOR' || activeCollection?.role === 'OWNER';

  // Inside a collection, load ALL its files so each subfolder can show the same
  // rolled-up ingestion badge the root collections do. (The tree loads files
  // lazily per folder, so it alone can't roll up an unopened subfolder.)
  const [allCollectionFiles] = useCachedQuery(
    queries.collectionFilesByRoot({ rootCollectionId: collectionId ?? '' }),
    // Only inside a collection — never register this on the KB root. Object form
    // is required; a bare boolean is ignored by useCachedQuery (always enabled).
    { enabled: !isAtRoot && !!collectionId },
  );

  // folderId → rolled-up counts of every file anywhere beneath it (recursive).
  const subfolderRollup = useMemo(() => {
    const map = new Map<
      string,
      { total: number; failed: number; processing: number; pending: number }
    >();
    if (isAtRoot || !collectionId) return map;
    for (const f of allCollectionFiles ?? []) {
      const status = (f.ingestionStatus ?? '').toUpperCase() as IngestionStatus;
      // Attribute the file to each ancestor subfolder, stopping at the root collection.
      let cur: string | null = f.collectionId;
      while (cur && cur !== collectionId) {
        let r = map.get(cur);
        if (!r) {
          r = { total: 0, failed: 0, processing: 0, pending: 0 };
          map.set(cur, r);
        }
        r.total += 1;
        if (status === IngestionStatus.FAILED) r.failed += 1;
        else if (status === IngestionStatus.PROCESSING) r.processing += 1;
        else if (status === IngestionStatus.PENDING) r.pending += 1;
        cur = nodes[cur]?.parentId ?? null;
      }
    }
    return map;
  }, [isAtRoot, collectionId, allCollectionFiles, nodes]);

  // ── Build entries ────────────────────────────────────────────────────
  const entries: CollectionChild[] = useMemo(() => {
    if (isAtRoot) {
      return globalCollections.collections.map(c => ({
        id: c.id,
        name: c.name,
        type: 'FOLDER' as NodeType,
        size: 0,
        updatedAt: new Date().toISOString(),
        ingestionStatus: c.ingestionStatus ?? null,
        mimeType: '',
        parentId: null,
        fileTotal: c.fileTotal,
        fileIngested: c.fileIngested,
        fileFailed: c.fileFailed,
      }));
    }

    const childIds = spParentId ? (nodes[spParentId]?.childrenIds ?? []) : rootChildrenIds;

    return childIds
      .map(id => nodes[id])
      .filter((n): n is CollectionTreeNode => Boolean(n))
      .map(node => {
        const child: CollectionChild = {
          id: node.id,
          name: node.name,
          type: node.type,
          size: node.size ?? 0,
          updatedAt: node.updatedAt,
          ingestionStatus: node.uploadStatus,
          mimeType: node.mimeType ?? '',
          parentId: node.parentId,
        };
        // Give subfolders the same rolled-up status badge as root collections.
        if (node.type === 'FOLDER') {
          const r = subfolderRollup.get(node.id);
          if (r && r.total > 0) {
            child.ingestionStatus =
              r.processing > 0
                ? IngestionStatus.PROCESSING
                : r.pending > 0
                  ? IngestionStatus.PENDING
                  : r.failed > 0
                    ? IngestionStatus.FAILED
                    : null;
            child.fileTotal = r.total;
            child.fileFailed = r.failed;
            child.fileIngested = r.total - r.failed - r.processing - r.pending;
          }
        }
        return child;
      });
  }, [
    isAtRoot,
    globalCollections.collections,
    spParentId,
    nodes,
    rootChildrenIds,
    subfolderRollup,
  ]);

  // Status filter — works the same at every level (root collections list or
  // any folder), since every CollectionChild (collection, folder, or file)
  // already carries a rolled-up `ingestionStatus`. Options are the fixed
  // full list (like Type's "Folders"), not limited to whatever's present —
  // picking one with no matches just shows an empty result.
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('ALL');
  // Type filter — same idea as status, but bucketed by "Folders" vs. each
  // file extension actually present (mirrors EntryListV2's own Kind column
  // logic) instead of a fixed list.
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const availableTypeFilters = useMemo(() => {
    // 'Folders' is always offered (mirrors Drive's Type menu, which always
    // lists Folders as a category) even when the current view has none —
    // picking it then just filters down to nothing, same as any other type
    // with zero matches.
    const seen = new Map<string, string>([['FOLDER', 'Folders']]);
    for (const e of entries) {
      const value = typeFilterValueFor(e);
      if (!seen.has(value)) seen.set(value, typeFilterLabelFor(value));
    }
    return [...seen.entries()]
      .map(([value, label]) => ({ value, label }))
      .sort((a, b) =>
        a.value === 'FOLDER' ? -1 : b.value === 'FOLDER' ? 1 : a.label.localeCompare(b.label),
      );
  }, [entries]);
  useEffect(() => {
    if (typeFilter !== 'ALL' && !availableTypeFilters.some(o => o.value === typeFilter)) {
      setTypeFilter('ALL');
    }
  }, [availableTypeFilters, typeFilter]);

  const filteredEntries = useMemo(
    () =>
      entries.filter(e => {
        if (statusFilter !== 'ALL' && normalizeStatusFilter(e.ingestionStatus) !== statusFilter) {
          return false;
        }
        if (typeFilter !== 'ALL' && typeFilterValueFor(e) !== typeFilter) return false;
        return true;
      }),
    [entries, statusFilter, typeFilter],
  );

  const folderCount = filteredEntries.filter(e => e.type === 'FOLDER').length;
  const fileCount = filteredEntries.filter(e => e.type === 'FILE').length;

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

  // ── URL writers ─────────────────────────────────────────────────────
  const updateParams = useCallback(
    (next: { cl?: string | null; parent?: string | null }, replace = false) => {
      const sp = new URLSearchParams(searchParams);
      const apply = (key: string, val: string | null | undefined): void => {
        if (val === undefined) return;
        if (val === null || val === '') sp.delete(key);
        else sp.set(key, val);
      };
      apply(SP_COLLECTION, next.cl);
      apply(SP_PARENT, next.parent);
      setSearchParams(sp, { replace });
    },
    [searchParams, setSearchParams],
  );

  // ── Navigation helpers ───────────────────────────────────────────────
  const goToCollections = useCallback((): void => {
    updateParams({ cl: null, parent: null });
  }, [updateParams]);

  const goToCollection = useCallback(
    (clId: string): void => {
      updateParams({ cl: clId, parent: null });
    },
    [updateParams],
  );

  const goToFolder = useCallback(
    (folderId: string): void => {
      if (!collectionId) return;
      updateParams({ cl: collectionId, parent: folderId });
    },
    [collectionId, updateParams],
  );

  const goToParent = useCallback(
    (parentId: string | null): void => {
      if (!collectionId) return;
      updateParams({ cl: collectionId, parent: parentId });
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
      if (owning.scopeType === 'WORKSPACE') return 'Workspace';
      const channelName = channelNameById.get(owning.scopeId);
      const projectName = owning.projectId ? projectNameById.get(owning.projectId) : undefined;
      if (channelName && projectName) return `#${channelName} · ${projectName}`;
      if (channelName) return `#${channelName}`;
      return 'Collection';
    },
    [globalCollections, channelNameById, projectNameById],
  );

  // Open the per-collection ingestion status drawer (root badge click).
  const onOpenStatus = useCallback(
    (entry: CollectionChild): void => {
      if (isAtRoot) {
        setStatusFor({
          id: entry.id,
          name: entry.name,
          location: locationOf(entry),
          rootCollectionId: entry.id,
        });
        return;
      }
      if (!collectionId) return;
      // Subfolder: scope the drawer to files under this folder (itself + descendants).
      setStatusFor({
        id: entry.id,
        name: entry.name,
        rootCollectionId: collectionId,
        folderIds: collectSubtreeFolderIds(entry.id, nodes),
      });
    },
    [isAtRoot, collectionId, locationOf, nodes],
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
      // to the existing nested viewer URL. Use the entry's own `parentId`,
      // not `spParentId` (the currently-browsed folder) — search results can
      // come from anywhere in the collection, so a match outside the folder
      // you're currently viewing would otherwise point the URL, and so
      // `nodes[fileId]` resolution in FileViewerPanel, at the wrong folder
      // and show "No file selected".
      const found = globalCollections.byId(collectionId);
      const channelId = found?.scopeId;
      if (channelId) {
        // `projectId` is only known for CHANNEL-scoped collections whose
        // channel is in our visible-channel list — '_' for workspace-scoped
        // (or unresolvable) collections, same sentinel as the folder segment.
        const projectId = found?.projectId ?? '_';
        void navigate(
          `${browseBasePath}/${projectId}/${channelId}/${collectionId}/${
            entry.parentId ?? '_'
          }/${entry.id}`,
        );
      } else {
        toast.error('Could not resolve collection scope');
      }
    },
    [
      isAtRoot,
      goToCollection,
      goToFolder,
      navigate,
      collectionId,
      globalCollections,
      browseBasePath,
    ],
  );

  // ── Mutations ─────────────────────────────────────────────────────────
  const submitNewFolder = async (name: string): Promise<void> => {
    if (!collectionId) return;
    if (!user) {
      toast.error('You must be logged in');
      return;
    }
    if (!canEdit) {
      toast.error("You don't have permission to add to this collection");
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
      if (!canEdit) {
        toast.error("You don't have permission to add to this collection");
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
      canEdit,
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
    if (!canEdit) {
      toast.error("You don't have permission to delete from this collection");
      return;
    }
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
    } else if (!canEdit) {
      toast.error("You don't have permission to rename items in this collection");
      return;
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
          if (!canEdit) {
            toast.error("You don't have permission to rename items in this collection");
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
    [user, isAtRoot, collectionId, canEdit, renameCollection, renameNode, globalCollections],
  );

  // ── Entry deep link ──────────────────────────────────────────────────
  // Same URL shape onOpenEntry navigates to. There's no separate ACL for
  // this: whoever opens it needs access to the owning collection already
  // (or gets Shared it separately), matching how every other "copy link"
  // button in the app works (Canvas, messages). Used by onShare below to
  // seed both the collection dialog's link and the folder/file dialog's link.
  const buildEntryLink = useCallback(
    (entry: CollectionChild): string | null => {
      const base = window.location.origin + browseBasePath;
      if (entry.type === 'FOLDER') {
        if (isAtRoot) return `${base}?cl=${entry.id}`;
        if (!collectionId) return null;
        return `${base}?cl=${collectionId}&parent=${entry.id}`;
      }
      if (!collectionId) return null;
      const owning = globalCollections.byId(collectionId);
      const channelId = owning?.scopeId;
      if (!channelId) return null;
      // `projectId` is only known for CHANNEL-scoped collections whose channel
      // is in our visible-channel list; '_' mirrors the existing "no folder"
      // sentinel below — the file-viewer route only needs a 5-segment URL,
      // it doesn't require projectId/channelId to resolve to real entities.
      const projectId = owning?.projectId ?? '_';
      return `${base}/${projectId}/${channelId}/${collectionId}/${entry.parentId ?? '_'}/${entry.id}`;
    },
    [browseBasePath, isAtRoot, collectionId, globalCollections],
  );

  // ── Share ─────────────────────────────────────────────────────────────
  // One entry point for every "Share" button in the screen — it routes to
  // one of two dialogs depending on what's being shared:
  //   - At root (collection cards): the full access-management dialog
  //     (ShareCollectionModal — per-user roles, public/private visibility).
  //     Open to anyone with a resolved role; the dialog itself bounds what
  //     each role can actually do.
  //   - Inside a collection (a regular folder/file): those have no ACL of
  //     their own — access is entirely inherited from the owning collection
  //     — so there's nothing to grant, just a copy-link-only dialog
  //     (ShareLinkModal).
  const onShare = (entry: CollectionChild): void => {
    if (!isAtRoot) {
      const link = buildEntryLink(entry);
      if (!link) {
        toast.error('Could not build a link for this item');
        return;
      }
      setLinkShareTarget(entry);
      return;
    }
    // The modal validates against `activeCollection.role` internally, so we
    // seed it on the machine before opening — the URL→machine sync effect
    // only re-runs when spCollectionId changes, so our seed sticks for the
    // lifetime of the modal. Anyone with a resolved role (Viewer/Editor/
    // Owner) can open the dialog — there's no separate "canShare" gate;
    // what they can actually do inside it is bounded by role escalation.
    const owning = globalCollections.byId(entry.id);
    if (!owning) {
      toast.error('Could not resolve collection');
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

  // ── Ask AI ──────────────────────────────────────────────────────────
  // Rendered at every level, including the root Knowledge listing (isAtRoot,
  // no collectionId) — the tooltip has dedicated copy for that case. At root
  // there's nothing to scope to, so just open a fresh, unscoped chat instead
  // of silently no-oping. The channelId comes from the global collections
  // cache because V2 doesn't carry it in the URL.
  //
  // Inside a sub-folder (spParentId set), attach BOTH chips — the folder
  // (for scope) and its collection (for context) — same "harmless overlap"
  // the composer's own picker already allows when you select a collection
  // and one of its folders together. At the collection root there's no
  // folder to add, so just the collection chip shows, as before.
  const handleOpenAI = useCallback((): void => {
    if (!collectionId) {
      xyneAIActor.send({ type: 'OPEN', startFreshChat: true });
      return;
    }
    const owning = globalCollections.byId(collectionId);
    const currentFolder = spParentId ? nodes[spParentId] : undefined;
    xyneAIActor.send({
      type: 'OPEN',
      startFreshChat: true,
      kbCollectionId: collectionId,
      kbChannelId: owning?.scopeId ?? null,
      ...(currentFolder && { kbFolderId: currentFolder.id, kbFolderName: currentFolder.name }),
    });
  }, [collectionId, globalCollections, spParentId, nodes]);

  // Per-row Ask AI (hover action on every folder/file, next to Share). A
  // file gets precise scoping via kbDocId/kbDocName — the machine already
  // supports asking about one specific document (same path FileViewerLayout
  // uses from inside the viewer). A folder row attaches BOTH itself
  // (kbFolderId) and its collection (kbCollectionId) when it's a genuine
  // sub-folder inside an open collection — same "harmless overlap" as
  // handleOpenAI; at root, `entry` IS a root collection (isAtRoot only
  // lists root collections), so it scopes as just a collection instead.
  const onAskAIAboutEntry = useCallback(
    (entry: CollectionChild): void => {
      if (entry.type === 'FILE') {
        const owning = collectionId ? globalCollections.byId(collectionId) : null;
        xyneAIActor.send({
          type: 'OPEN',
          startFreshChat: true,
          kbCollectionId: collectionId ?? null,
          kbChannelId: owning?.scopeId ?? null,
          kbDocId: entry.id,
          kbDocName: entry.name,
        });
        return;
      }
      if (isAtRoot) {
        const owning = globalCollections.byId(entry.id);
        xyneAIActor.send({
          type: 'OPEN',
          startFreshChat: true,
          kbCollectionId: entry.id,
          kbChannelId: owning?.scopeId ?? null,
        });
        return;
      }
      const owning = collectionId ? globalCollections.byId(collectionId) : null;
      xyneAIActor.send({
        type: 'OPEN',
        startFreshChat: true,
        kbCollectionId: collectionId ?? null,
        kbChannelId: owning?.scopeId ?? null,
        kbFolderId: entry.id,
        kbFolderName: entry.name,
      });
    },
    [collectionId, globalCollections, isAtRoot],
  );

  // ── Header label ─────────────────────────────────────────────────────
  const rootLabel = isAtRoot
    ? 'Knowledge'
    : (activeCollection?.name ?? globalCollections.byId(collectionId ?? '')?.name ?? 'Collection');

  const loading = isInitialLoading || (isAtRoot && globalCollections.isLoading);

  const header = (
    <div className='flex flex-wrap items-center justify-end gap-2 border-b border-border ai-page-bg px-5 py-2.5'>
      <Tooltip
        content={isAtRoot ? 'Ask AI' : `Ask AI about this ${spParentId ? 'folder' : 'collection'}`}
        side='bottom'
      >
        <button
          type='button'
          onClick={handleOpenAI}
          aria-label='Ask AI'
          data-track-category='knowledge-base'
          data-track-name='kb-open-ai-chat'
          className='inline-flex h-10 w-10 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-sm transition hover:bg-muted'
        >
          <XyneAIStar size={22} />
        </button>
      </Tooltip>
      {isAtRoot ? (
        // Collections are channel-scoped, so creation must go through the
        // CreateCollectionModal (it owns the channel picker + name step).
        // The single-field NameDialog can't capture scope, so we wire
        // root creation through the scoped modal.
        <button
          type='button'
          onClick={() => setIsCreateModalOpen(true)}
          className='inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-[13px] font-medium text-foreground shadow-sm transition hover:bg-muted'
          data-track-category='knowledge-base'
          data-track-name='new-collection'
        >
          <Plus className='h-4 w-4' strokeWidth={1.75} />
          New collection
        </button>
      ) : canEdit ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                className='inline-flex h-10 items-center gap-1.5 rounded-full border border-border bg-background px-4 text-[13px] font-medium text-foreground shadow-sm transition hover:bg-muted'
                data-track-category='knowledge-base'
                data-track-name='open-new-menu'
              >
                {isUploadingForThisCollection ? (
                  <Loader2 className='h-4 w-4 animate-spin' strokeWidth={1.75} />
                ) : (
                  <Plus className='h-4 w-4' strokeWidth={1.75} />
                )}
                New
                <ChevronDown className='h-3.5 w-3.5' strokeWidth={1.75} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end'>
              <DropdownMenuItem
                onClick={() => setDialog('folder')}
                data-track-category='knowledge-base'
                data-track-name='new-folder'
              >
                <FolderPlus className='h-4 w-4' strokeWidth={1.75} />
                New folder
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={onPickFiles}
                data-track-category='knowledge-base'
                data-track-name='PICK_KB_FILES'
              >
                <File className='h-4 w-4' strokeWidth={1.75} />
                Upload files
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => folderInputRef.current?.click()}
                data-track-category='knowledge-base'
                data-track-name='PICK_KB_FOLDER'
              >
                <FolderOpen className='h-4 w-4' strokeWidth={1.75} />
                Upload folder
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => setDriveLinkOpen(true)}
                data-track-category='knowledge-base'
                data-track-name='add-from-drive'
              >
                <Link2 className='h-4 w-4' strokeWidth={1.75} />
                Add from Drive
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
      ) : null}
      <ViewToggleV2 value={view} onChange={setView} />
    </div>
  );

  const breadcrumbRow = (
    <div className='flex min-w-0 items-center gap-2 px-5 py-2.5'>
      <button
        type='button'
        aria-label={
          isAtRoot ? 'Back to Ask AI' : isAtCollectionRoot ? 'Back to collections' : 'Up one level'
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
  );

  // A second, labeled Ask AI entry point sitting inline with the folder/file
  // count, directly above the list — mirrors Drive's "Ask Gemini" pill,
  // which sits in the same spot relative to its file table. The header's
  // circular icon is the primary action; this is a secondary, more
  // discoverable prompt right where you're about to look for it while
  // browsing.
  const askAiPill = (
    <button
      type='button'
      onClick={handleOpenAI}
      data-track-category='knowledge-base'
      data-track-name='kb-open-ai-chat-pill'
      className='inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/10 px-3 text-[12.5px] font-medium text-foreground transition hover:bg-primary/15'
    >
      <XyneAIStar size={14} />
      Ask AI
    </button>
  );

  const mainContent = (
    <main ref={mainRef} className='relative flex-1 overflow-auto px-5 py-5'>
      {dragging ? (
        <div className='pointer-events-none absolute inset-3 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary/60 bg-background/80 text-[14px] font-medium text-foreground'>
          Drop files to upload
        </div>
      ) : null}
      <div className='mx-auto w-full max-w-7xl'>
        <div className='mb-3 flex items-center gap-3'>
          {askAiPill}
          <p className='text-[12px] text-muted-foreground'>
            {loading
              ? 'Loading...'
              : isAtRoot
                ? filteredEntries.length === 0
                  ? 'No collections yet'
                  : `${String(filteredEntries.length)} collection${filteredEntries.length === 1 ? '' : 's'}`
                : filteredEntries.length === 0
                  ? 'This folder is empty'
                  : [
                      folderCount > 0
                        ? `${String(folderCount)} folder${folderCount === 1 ? '' : 's'}`
                        : null,
                      fileCount > 0
                        ? `${String(fileCount)} file${fileCount === 1 ? '' : 's'}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
          </p>

          {/* Type / Status filters — Drive-style pill buttons, always present
              at every level (root or any folder), not just when more than
              one option happens to be available right now. */}
          <div className='ml-auto flex items-center gap-2'>
            <div className='inline-flex items-center gap-1'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium shadow-sm transition',
                      typeFilter === 'ALL'
                        ? 'border-border bg-background text-foreground hover:bg-muted'
                        : 'border-primary/20 bg-primary/10 text-foreground hover:bg-primary/15',
                    )}
                    data-track-category='knowledge-base'
                    data-track-name='kb-type-filter'
                  >
                    {typeFilter === 'ALL'
                      ? 'Type'
                      : (availableTypeFilters.find(o => o.value === typeFilter)?.label ?? 'Type')}
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5',
                        typeFilter === 'ALL' ? 'text-muted-foreground' : 'text-foreground',
                      )}
                      strokeWidth={1.75}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem
                    onClick={() => setTypeFilter('ALL')}
                    data-track-category='knowledge-base'
                    data-track-name='kb-type-filter-all'
                  >
                    All
                  </DropdownMenuItem>
                  {availableTypeFilters.map(opt => (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => setTypeFilter(opt.value)}
                      data-track-category='knowledge-base'
                      data-track-name='kb-type-filter-select'
                    >
                      <span className='flex items-center gap-2'>
                        {typeFilterIcon(opt.value)}
                        {opt.label}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {typeFilter !== 'ALL' ? (
                <button
                  type='button'
                  onClick={() => setTypeFilter('ALL')}
                  aria-label='Clear type filter'
                  title='Clear type filter'
                  className='grid h-8 w-8 place-items-center rounded-full border border-primary/20 bg-primary/10 text-foreground transition hover:bg-primary/15'
                  data-track-category='knowledge-base'
                  data-track-name='kb-type-filter-clear'
                >
                  <X className='h-3.5 w-3.5' strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
            <div className='inline-flex items-center gap-1'>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type='button'
                    className={cn(
                      'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[12.5px] font-medium shadow-sm transition',
                      statusFilter === 'ALL'
                        ? 'border-border bg-background text-foreground hover:bg-muted'
                        : 'border-primary/20 bg-primary/10 text-foreground hover:bg-primary/15',
                    )}
                    data-track-category='knowledge-base'
                    data-track-name='kb-status-filter'
                  >
                    {statusFilter === 'ALL'
                      ? 'Status'
                      : (STATUS_FILTER_OPTIONS.find(o => o.value === statusFilter)?.label ??
                        'Status')}
                    <ChevronDown
                      className={cn(
                        'h-3.5 w-3.5',
                        statusFilter === 'ALL' ? 'text-muted-foreground' : 'text-foreground',
                      )}
                      strokeWidth={1.75}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align='end'>
                  <DropdownMenuItem
                    onClick={() => setStatusFilter('ALL')}
                    data-track-category='knowledge-base'
                    data-track-name='kb-status-filter-all'
                  >
                    All
                  </DropdownMenuItem>
                  {STATUS_FILTER_OPTIONS.map(opt => (
                    <DropdownMenuItem
                      key={opt.value}
                      onClick={() => setStatusFilter(opt.value)}
                      data-track-category='knowledge-base'
                      data-track-name='kb-status-filter-select'
                    >
                      <span className='flex items-center gap-2'>
                        {statusFilterIcon(opt.value)}
                        {opt.label}
                      </span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              {statusFilter !== 'ALL' ? (
                <button
                  type='button'
                  onClick={() => setStatusFilter('ALL')}
                  aria-label='Clear status filter'
                  title='Clear status filter'
                  className='grid h-8 w-8 place-items-center rounded-full border border-primary/20 bg-primary/10 text-foreground transition hover:bg-primary/15'
                  data-track-category='knowledge-base'
                  data-track-name='kb-status-filter-clear'
                >
                  <X className='h-3.5 w-3.5' strokeWidth={1.75} />
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {filteredEntries.length === 0 && !loading && !isUploadingForThisCollection ? (
          entries.length > 0 ? (
            <div className='mx-auto flex max-w-md flex-col items-center justify-center gap-2 py-24 text-center'>
              <p className='text-[14px] font-medium text-foreground'>No items match this filter</p>
              <p className='max-w-xs text-[12.5px] text-muted-foreground'>
                Try a different status, or clear the filter to see everything here.
              </p>
            </div>
          ) : (
            <EmptyPaneV2 isRoot={isAtRoot} />
          )
        ) : view === 'grid' ? (
          <EntryGridV2
            entries={filteredEntries}
            onOpen={onOpenEntry}
            {...(isAtRoot || canEdit
              ? {
                  onDelete: (e: CollectionChild): void => {
                    void onDelete(e);
                  },
                  onRename,
                }
              : {})}
            editingId={renameTarget?.id ?? null}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            scrollParentRef={mainRef}
            onOpenStatus={onOpenStatus}
            onAskAI={onAskAIAboutEntry}
            onShare={onShare}
            {...(isAtRoot ? { folderCaption: locationOf } : {})}
          />
        ) : (
          <EntryListV2
            entries={filteredEntries}
            columns={isAtRoot ? [...KB_ROOT_COLUMNS] : [...KB_COLUMNS]}
            onOpen={onOpenEntry}
            {...(isAtRoot || canEdit
              ? {
                  onDelete: (e: CollectionChild): void => {
                    void onDelete(e);
                  },
                  onRename,
                }
              : {})}
            editingId={renameTarget?.id ?? null}
            onRenameCommit={onRenameCommit}
            onRenameCancel={onRenameCancel}
            scrollParentRef={mainRef}
            onOpenStatus={onOpenStatus}
            onAskAI={onAskAIAboutEntry}
            onShare={onShare}
            {...(isAtRoot
              ? {
                  resolveColumnValue: (entry, key): string | undefined =>
                    key === 'location' ? locationOf(entry) : undefined,
                }
              : {})}
          />
        )}
      </div>
    </main>
  );

  return (
    <div
      className='flex h-full flex-col bg-background'
      onDragOver={e => {
        e.preventDefault();
        if (collectionId && canEdit) {
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
      {header}
      {breadcrumbRow}
      {mainContent}

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
            const link = buildEntryLink(shareTarget);
            return (
              <ShareCollectionModal
                isOpen
                onClose={closeShare}
                collectionId={shareTarget.id}
                collectionName={shareTarget.name}
                channelId={owning?.scopeType === 'CHANNEL' ? (owning.scopeId ?? null) : null}
                isPrivate={owning?.isPrivate ?? false}
                canEditVisibility={owning?.role === 'OWNER'}
                {...(link ? { link } : {})}
              />
            );
          })()
        : null}

      {linkShareTarget ? (
        <ShareLinkModal
          isOpen
          onClose={() => setLinkShareTarget(null)}
          title={linkShareTarget.name}
          link={buildEntryLink(linkShareTarget) ?? ''}
        />
      ) : null}

      <CollectionStatusDrawer collection={statusFor} onClose={() => setStatusFor(null)} />

      <AddDriveLinkModal
        isOpen={driveLinkOpen}
        onClose={() => setDriveLinkOpen(false)}
        collectionId={collectionId ?? null}
        collectionName={activeCollection?.name ?? rootLabel}
        parentId={spParentId}
      />
      <DriveConnectDialog />
    </div>
  );
};

export default KnowledgeBaseV2Screen;
