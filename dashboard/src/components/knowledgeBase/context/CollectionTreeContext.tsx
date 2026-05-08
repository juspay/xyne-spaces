import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
  useMemo,
} from 'react';
import { useParams } from 'react-router-dom';
import {
  CollectionRole,
  NodeType,
  UploadStatus,
  FailedCollectionItem,
} from '../../../services/Knowledge/collectionService';
import { TreeNodeData } from '../tree/treeTypes';
import { useAuth } from '../../../hooks/useAuth';
import { useProjectCollections } from './ProjectCollectionsContext';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useQuery } from '../../../hooks/useQuery';
import { queries } from '../../../zero/queries';

// ─── Sort Types ──────────────────────────────────────────────────────────────────

export type SortField = 'name' | 'date' | 'size';
export type SortOrder = 'asc' | 'desc';

export interface SortOption {
  field: SortField;
  order: SortOrder;
}

// Helper to create sort key
const getSortKey = (sortOption: SortOption): string => {
  return `${sortOption.field}_${sortOption.order}`;
};

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CollectionTreeNode {
  id: string;
  name: string;
  type: NodeType;
  parentId: string | null;
  uploadStatus: UploadStatus;
  size: number;
  updatedAt: string;
  mimeType: string;
  /** Ordered IDs of direct children */
  childrenIds: string[];
  /** Whether this folder is expanded in the tree view */
  isExpanded: boolean;
  /** Always true when driven by Zero (all data is immediately available) */
  isLoaded: boolean;
  /** Always false when driven by Zero (no lazy-loading) */
  isLoading: boolean;
  /** Raw metadata JSON from the DB (contains entityTags after extraction) */
  metadata: Record<string, unknown> | null;
}

export interface CollectionTreeContextValue {
  // ── Collection identity ──
  collectionId: string | null;
  /** Role for the current user */
  collectionRole: CollectionRole | undefined;
  /** Whether the current user can share this collection */
  collectionCanShare: boolean | undefined;

  // ── Flat node store ──
  nodes: Record<string, CollectionTreeNode>;
  rootChildrenIds: string[];
  isInitialLoading: boolean;

  // ── Grid/List-view folder navigation ──
  currentFolderId: string | null;
  setCurrentFolderId: (id: string | null) => void;

  // ── View mode ──
  viewMode: 'tree' | 'grid' | 'list';
  setViewMode: (mode: 'tree' | 'grid' | 'list') => void;

  // ── Tree operations ──
  toggleFolder: (folderId: string) => Promise<void>;
  expandFolder: (folderId: string) => Promise<void>;
  collapseFolder: (folderId: string) => void;

  // ── Derived helpers ──
  getTreeData: (
    rootId?: string,
    rootName?: string,
    startFromFolderId?: string | null,
    sortOption?: SortOption,
  ) => TreeNodeData | null;
  getChildrenOf: (parentId: string | null) => CollectionTreeNode[];
  getSortedChildren: (parentId: string | null, sortOption: SortOption) => CollectionTreeNode[];

  // ── Refresh (no-op — Zero handles real-time sync) ──
  refreshFolder: (folderId: string | null) => Promise<void>;

  // ── Failed uploads ──
  failedItems: FailedCollectionItem[];

  // ── Hydrate ancestors ──
  hydrateAncestors: (itemId: string | null, cId: string | null) => Promise<void>;

  // ── Rename ──
  renameNode: (nodeId: string, newName: string) => Promise<void>;

  // ── Delete ──
  deleteNode: (nodeId: string) => Promise<void>;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const CollectionTreeContext = createContext<CollectionTreeContextValue | null>(null);

export const useCollectionTree = (): CollectionTreeContextValue => {
  const ctx = useContext(CollectionTreeContext);
  if (!ctx) {
    throw new Error('useCollectionTree must be used within a CollectionTreeProvider');
  }
  return ctx;
};

// ─── Provider ─────────────────────────────────────────────────────────────────

interface CollectionTreeProviderProps {
  children: React.ReactNode;
}

export const CollectionTreeProvider: React.FC<CollectionTreeProviderProps> = ({ children }) => {
  // ── Auth & Project Context ──
  const { user } = useAuth();
  const { activeCollection } = useProjectCollections();
  const zero = useZero();

  const collectionId = activeCollection?.id ?? null;
  const collectionRole = activeCollection?.role;
  const collectionCanShare = activeCollection?.canShare;

  // ── Read folderId from URL params (for deep-link / page refresh support) ──
  const params = useParams<{
    projectId?: string;
    collectionId?: string;
    folderId?: string;
    fileId?: string;
  }>();
  const urlFolderId = params.folderId && params.folderId !== '_' ? params.folderId : null;

  // ── Local UI state ──
  const [expansionState, setExpansionState] = useState<Record<string, boolean>>({});
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'tree' | 'grid' | 'list'>('list');

  // ── Sort Cache (ref — safe to mutate during useMemo since no re-render triggered) ──
  const sortedChildrenCacheRef = useRef<Record<string, Record<string, string[]>>>({});

  // ── Refs for stable callbacks ──
  const collectionIdRef = useRef(collectionId);
  const nodesRef = useRef<Record<string, CollectionTreeNode>>({});
  const viewModeRef = useRef(viewMode);
  const currentFolderIdRef = useRef(currentFolderId);
  const userIdRef = useRef(user?.id);

  useEffect(() => {
    collectionIdRef.current = collectionId;
  }, [collectionId]);
  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);
  useEffect(() => {
    currentFolderIdRef.current = currentFolderId;
  }, [currentFolderId]);
  useEffect(() => {
    userIdRef.current = user?.id;
  }, [user?.id]);

  // ── Zero query: all non-deleted items for this collection ──
  const queryEnabled = !!collectionId;
  const [zeroItems, { type: itemsQueryType }] = useQuery(
    queries.collectionItems({ collectionId: collectionId ?? '' }),
    queryEnabled,
  );

  const isInitialLoading = queryEnabled && itemsQueryType !== 'complete';

  // ── Reset when collection changes ──
  useEffect(() => {
    setExpansionState({});
    setCurrentFolderId(null);
    sortedChildrenCacheRef.current = {};
  }, [collectionId]);

  // ── Derive nodes from Zero data + expansion state ──
  const nodes = useMemo(() => {
    // Invalidate sort cache whenever items change
    sortedChildrenCacheRef.current = {};

    const childrenMap: Record<string, string[]> = {};
    for (const item of zeroItems) {
      const parentKey = item.parentId ?? '__root__';
      (childrenMap[parentKey] ??= []).push(item.id);
    }

    const result: Record<string, CollectionTreeNode> = {};
    for (const item of zeroItems) {
      result[item.id] = {
        id: item.id,
        name: item.name,
        type: item.type as NodeType,
        parentId: item.parentId ?? null,
        uploadStatus: item.uploadStatus as UploadStatus,
        size: item.fileSize ?? 0,
        updatedAt: item.updatedAt
          ? new Date(item.updatedAt).toISOString()
          : new Date().toISOString(),
        mimeType: item.mimeType ?? '',
        childrenIds: childrenMap[item.id] ?? [],
        isExpanded: expansionState[item.id] ?? false,
        isLoaded: true,
        isLoading: false,
        metadata: (item.metadata as Record<string, unknown>) ?? null,
      };
    }
    return result;
  }, [zeroItems, expansionState]);

  // ── Derive rootChildrenIds ──
  const rootChildrenIds = useMemo(
    () => zeroItems.filter(item => !item.parentId).map(item => item.id),
    [zeroItems],
  );

  // ── Derive failedItems ──
  const failedItems: FailedCollectionItem[] = useMemo(
    () =>
      zeroItems
        .filter(item => (item.uploadStatus as string) === 'FAILED')
        .map(item => ({
          id: item.id,
          name: item.name,
          parentId: item.parentId ?? null,
          statusMessage: item.statusMessage ?? null,
        })),
    [zeroItems],
  );

  // ── Keep nodesRef in sync ──
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  // ── Sorted cache invalidation helper ──
  const invalidateSortedCache = useCallback(
    (parentId: string | null, invalidateAll: boolean = false) => {
      if (invalidateAll) {
        sortedChildrenCacheRef.current = {};
      } else {
        const cacheKey = parentId ?? 'root';
        const updated = { ...sortedChildrenCacheRef.current };
        delete updated[cacheKey];
        sortedChildrenCacheRef.current = updated;
      }
    },
    [],
  );

  // ── Hydrate ancestors on deep-link (wait for Zero data) ──
  const hydrateAncestors = useCallback(
    (itemId: string | null, _cId: string | null): Promise<void> => {
      if (!itemId) return Promise.resolve();
      const item = nodesRef.current[itemId];
      if (!item) return Promise.resolve();
      // If it's a FILE, set currentFolderId to its parent
      if ((item.type as string) === 'FILE' && item.parentId) {
        setCurrentFolderId(item.parentId);
      }
      return Promise.resolve();
    },
    [],
  );

  // ── Set currentFolderId from URL when Zero data is ready ──
  useEffect(() => {
    if (!collectionId || !urlFolderId || itemsQueryType !== 'complete') return;
    if (!nodesRef.current[urlFolderId]) return;
    setCurrentFolderId(urlFolderId);
  }, [collectionId, urlFolderId, itemsQueryType]);

  // ── Expand / Collapse / Toggle ──

  const expandFolder = useCallback(
    (folderId: string): Promise<void> => {
      setExpansionState(prev => ({ ...prev, [folderId]: true }));
      invalidateSortedCache(folderId);
      return Promise.resolve();
    },
    [invalidateSortedCache],
  );

  const collapseFolder = useCallback((folderId: string) => {
    setExpansionState(prev => ({ ...prev, [folderId]: false }));
  }, []);

  const toggleFolder = useCallback(
    (folderId: string): Promise<void> => {
      if (folderId === collectionIdRef.current) return Promise.resolve();
      const currentNode = nodesRef.current[folderId];
      if (!currentNode || (currentNode.type as string) !== 'FOLDER') return Promise.resolve();
      setExpansionState(prev => ({ ...prev, [folderId]: !prev[folderId] }));
      invalidateSortedCache(folderId);
      return Promise.resolve();
    },
    [invalidateSortedCache],
  );

  // ── Refresh (no-op — Zero handles real-time sync) ──
  const refreshFolder = useCallback(async (_folderId: string | null) => {
    // Zero automatically syncs changes; no manual refresh needed.
  }, []);

  // ── Rename ──
  const renameNode = useCallback(
    async (nodeId: string, newName: string) => {
      const node = nodesRef.current[nodeId];
      if (!node) throw new Error('Node not found');
      if (!collectionIdRef.current) throw new Error('No collection selected');
      if (!userIdRef.current) throw new Error('User not authenticated');

      // Invalidate sort cache (name change may affect sort order)
      invalidateSortedCache(node.parentId);

      await zero.mutate(
        mutators.collection.renameItem({
          id: nodeId,
          collectionId: collectionIdRef.current,
          name: newName,
          timestamp: Date.now(),
        }),
      ).server;
    },
    [zero, invalidateSortedCache],
  );

  // ── Delete Node ──
  const deleteNode = useCallback(
    async (nodeId: string) => {
      const node = nodesRef.current[nodeId];
      if (!node) throw new Error('Node not found');
      if (!collectionIdRef.current) throw new Error('No collection selected');
      if (!userIdRef.current) throw new Error('User not authenticated');

      // Navigate away if the deleted folder is currently open
      if (currentFolderIdRef.current === nodeId) {
        setCurrentFolderId(node.parentId);
      }

      await zero.mutate(
        mutators.collection.deleteItem({
          id: nodeId,
          collectionId: collectionIdRef.current,
          timestamp: Date.now(),
        }),
      ).server;
    },
    [zero],
  );

  // ── Derived: getChildrenOf ──
  const getChildrenOf = useCallback(
    (parentId: string | null): CollectionTreeNode[] => {
      if (parentId === null) {
        return rootChildrenIds
          .map(id => nodes[id])
          .filter((n): n is CollectionTreeNode => n !== undefined);
      }
      const parent = nodes[parentId];
      if (!parent) return [];
      return parent.childrenIds
        .map(id => nodes[id])
        .filter((n): n is CollectionTreeNode => n !== undefined);
    },
    [nodes, rootChildrenIds],
  );

  // ── Derived: getSortedChildren (with cache) ──
  const getSortedChildren = useCallback(
    (parentId: string | null, sortOption: SortOption): CollectionTreeNode[] => {
      const cacheKey = parentId ?? 'root';
      const sortKey = getSortKey(sortOption);

      const cached = sortedChildrenCacheRef.current[cacheKey]?.[sortKey];
      if (cached) {
        return cached.map(id => nodes[id]).filter((n): n is CollectionTreeNode => n !== undefined);
      }

      const children = getChildrenOf(parentId);

      const sorted = [...children].sort((a, b) => {
        if (a.type !== b.type) {
          return (a.type as string) === 'FOLDER' ? -1 : 1;
        }

        let comparison = 0;
        switch (sortOption.field) {
          case 'name':
            comparison = a.name.localeCompare(b.name);
            break;
          case 'date':
            comparison = new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
            break;
          case 'size':
            comparison = a.size - b.size;
            break;
        }

        return sortOption.order === 'asc' ? comparison : -comparison;
      });

      const sortedIds = sorted.map(n => n.id);
      sortedChildrenCacheRef.current = {
        ...sortedChildrenCacheRef.current,
        [cacheKey]: {
          ...sortedChildrenCacheRef.current[cacheKey],
          [sortKey]: sortedIds,
        },
      };

      return sorted;
    },
    [nodes, rootChildrenIds, getChildrenOf],
  );

  // ── Tree builders ──

  const buildTreeNode = useCallback(
    (nodeId: string): TreeNodeData | null => {
      const node = nodes[nodeId];
      if (!node) return null;

      const result: TreeNodeData = {
        id: node.id,
        name: node.name,
        type: node.type,
        status: node.uploadStatus,
        isExpanded: node.isExpanded,
        isLoading: node.isLoading,
      };

      if (node.type === 'FOLDER') {
        if (node.isExpanded && node.childrenIds.length > 0) {
          result.children = node.childrenIds
            .map(id => buildTreeNode(id))
            .filter((n): n is TreeNodeData => n !== null);
        } else if (node.childrenIds.length > 0) {
          // Has children but collapsed — show chevron
          result.children = [];
        }
      }

      return result;
    },
    [nodes],
  );

  const buildTreeNodeSorted = useCallback(
    (nodeId: string, sortOption: SortOption): TreeNodeData | null => {
      const node = nodes[nodeId];
      if (!node) return null;

      const result: TreeNodeData = {
        id: node.id,
        name: node.name,
        type: node.type,
        status: node.uploadStatus,
        isExpanded: node.isExpanded,
        isLoading: node.isLoading,
      };

      if (node.type === 'FOLDER') {
        if (node.isExpanded && node.childrenIds.length > 0) {
          const sortedChildren = getSortedChildren(nodeId, sortOption);
          result.children = sortedChildren
            .map(child => buildTreeNodeSorted(child.id, sortOption))
            .filter((n): n is TreeNodeData => n !== null);
        } else if (node.childrenIds.length > 0) {
          result.children = [];
        }
      }

      return result;
    },
    [nodes, getSortedChildren],
  );

  const getTreeData = useCallback(
    (
      rootId?: string,
      rootName?: string,
      startFromFolderId?: string | null,
      sortOption?: SortOption,
    ): TreeNodeData | null => {
      if (!collectionId) return null;

      if (startFromFolderId !== undefined && startFromFolderId !== null) {
        const startNode = nodes[startFromFolderId];
        if (!startNode || startNode.type !== 'FOLDER') {
          return null;
        }

        if (sortOption) {
          const sortedChildren = getSortedChildren(startFromFolderId, sortOption);
          const treeChildren = sortedChildren
            .map(child => buildTreeNodeSorted(child.id, sortOption))
            .filter((n): n is TreeNodeData => n !== null);

          return {
            id: rootId || collectionId,
            name: rootName || 'Collection',
            type: 'FOLDER' as NodeType,
            children: treeChildren,
            isExpanded: true,
          };
        } else {
          const children = getChildrenOf(startFromFolderId);
          const treeChildren = children
            .map(child => buildTreeNode(child.id))
            .filter((n): n is TreeNodeData => n !== null);

          return {
            id: rootId || collectionId,
            name: rootName || 'Collection',
            type: 'FOLDER' as NodeType,
            children: treeChildren,
            isExpanded: true,
          };
        }
      }

      if (rootChildrenIds.length === 0) return null;

      if (sortOption) {
        const sortedRootChildren = getSortedChildren(null, sortOption);
        const treeChildren = sortedRootChildren
          .map(child => buildTreeNodeSorted(child.id, sortOption))
          .filter((n): n is TreeNodeData => n !== null);

        return {
          id: rootId || collectionId,
          name: rootName || 'Collection',
          type: 'FOLDER' as NodeType,
          children: treeChildren,
          isExpanded: true,
        };
      } else {
        const children = getChildrenOf(null);
        const treeChildren = children
          .map(child => buildTreeNode(child.id))
          .filter((n): n is TreeNodeData => n !== null);

        return {
          id: rootId || collectionId,
          name: rootName || 'Collection',
          type: 'FOLDER' as NodeType,
          children: treeChildren,
          isExpanded: true,
        };
      }
    },
    [
      collectionId,
      rootChildrenIds,
      nodes,
      getSortedChildren,
      getChildrenOf,
      buildTreeNodeSorted,
      buildTreeNode,
    ],
  );

  // ── Context value ──

  const value: CollectionTreeContextValue = useMemo(
    () => ({
      collectionId,
      collectionRole,
      collectionCanShare,
      nodes,
      rootChildrenIds,
      isInitialLoading,
      currentFolderId,
      setCurrentFolderId,
      viewMode,
      setViewMode,
      toggleFolder,
      expandFolder,
      collapseFolder,
      getTreeData,
      getChildrenOf,
      getSortedChildren,
      refreshFolder,
      failedItems,
      hydrateAncestors,
      renameNode,
      deleteNode,
    }),
    [
      collectionId,
      collectionRole,
      collectionCanShare,
      nodes,
      rootChildrenIds,
      isInitialLoading,
      currentFolderId,
      setCurrentFolderId,
      viewMode,
      setViewMode,
      toggleFolder,
      expandFolder,
      collapseFolder,
      getTreeData,
      getChildrenOf,
      getSortedChildren,
      refreshFolder,
      failedItems,
      hydrateAncestors,
      renameNode,
      deleteNode,
    ],
  );

  return <CollectionTreeContext.Provider value={value}>{children}</CollectionTreeContext.Provider>;
};
