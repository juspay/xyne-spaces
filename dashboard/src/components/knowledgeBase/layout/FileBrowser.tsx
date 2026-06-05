import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { Header, ViewMode, SortOption, SortField, SortOrder } from './Header';
import { GridPanel } from '../grid/GridPanel';
import { ListView } from '../list/ListView';
import { FileEmptyState, SearchEmptyState } from '../shared/EmptyState';
import { TreeNode } from '../tree/TreeNode';
import {
  CollectionChild,
  NodeType,
  searchCollectionItems,
} from '../../../services/Knowledge/collectionService';
import { CollectionTreeNode } from '../tree/treeTypes';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { useCollectionMutations } from '../hooks/useCollectionMutations';
import { useTreeData } from '../hooks/useTreeData';
import { Breadcrumb } from '../shared/Breadcrumb';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';

interface FileBrowserProps {
  selectedCollectionId: string | null;
  collectionName: string | undefined;
  onOpenChat?: ((docId?: string, docName?: string) => void) | undefined;
}

export const FileBrowser: React.FC<FileBrowserProps> = ({
  selectedCollectionId,
  collectionName,
  onOpenChat,
}) => {
  const navigate = useNavigate();
  const params = useParams<{
    projectId?: string;
    channelId?: string;
    collectionId?: string;
    folderId?: string;
  }>();

  const {
    activeCollection,
    currentFolderId,
    setCurrentFolderId,
    setViewMode,
    sortedChildrenCacheRef,
    invalidateSortedCache,
    expansionState,
    toggleFolder,
    expandFolder,
    nodes,
    rootChildrenIds,
    isInitialLoading,
  } = useProjectCollections();
  const collectionId = activeCollection?.id ?? null;
  const { hydrateAncestors } = useCollectionMutations();
  const { getTreeData, getChildrenOf, getSortedChildren } = useTreeData({
    collectionId,
    nodes,
    rootChildrenIds,
    sortedChildrenCacheRef,
    expansionState,
  });

  const STORAGE_KEY_VIEW_MODE = 'kb_file_browser_view_mode';
  const STORAGE_KEY_SEARCH_QUERY = 'kb_file_browser_search_query';
  const STORAGE_KEY_SORT_OPTION = 'kb_file_browser_sort_option';

  const [localViewMode, setLocalViewMode] = useState<ViewMode>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_VIEW_MODE);
      return saved === 'grid' || saved === 'tree' || saved === 'list' ? saved : 'list';
    } catch {
      return 'list';
    }
  });

  const [searchQuery, setSearchQuery] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY_SEARCH_QUERY) || '';
    } catch {
      return '';
    }
  });

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  const [searchResults, setSearchResults] = useState<CollectionChild[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const lastCompletedSearchQueryRef = useRef<string>('');

  const [sortOption, setSortOption] = useState<SortOption | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SORT_OPTION);
      if (saved) {
        if (saved === 'null') return null;
        const parsed = JSON.parse(saved) as SortOption;
        if (parsed.field && parsed.order) return parsed;
      }
    } catch {
      // ignore
    }
    return null;
  });

  useEffect(() => {
    setViewMode(localViewMode);
  }, [localViewMode, setViewMode]);

  useEffect(() => {
    if (debouncedSearchQuery.trim() && localViewMode !== 'list') {
      setLocalViewMode('list');
    }
  }, [debouncedSearchQuery, localViewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_VIEW_MODE, localViewMode);
    } catch {
      // ignore
    }
  }, [localViewMode]);

  useEffect(() => {
    try {
      if (searchQuery) {
        localStorage.setItem(STORAGE_KEY_SEARCH_QUERY, searchQuery);
      } else {
        localStorage.removeItem(STORAGE_KEY_SEARCH_QUERY);
      }
    } catch {
      // ignore
    }
  }, [searchQuery]);

  useEffect(() => {
    try {
      localStorage.setItem(
        STORAGE_KEY_SORT_OPTION,
        sortOption === null ? 'null' : JSON.stringify(sortOption),
      );
    } catch {
      // ignore
    }
  }, [sortOption]);

  // '_' is the sentinel value for collection root
  const rawRouteFolderId = params.folderId || null;
  const routeFolderId = rawRouteFolderId === '_' ? null : rawRouteFolderId;
  const routeProjectId = params.projectId || null;
  const routeChannelId = params.channelId || null;
  const routeCollectionId = params.collectionId || selectedCollectionId;

  useEffect(() => {
    setCurrentFolderId(routeFolderId);
  }, [routeFolderId, setCurrentFolderId]);

  useEffect(() => {
    if (currentFolderId) {
      void expandFolder(currentFolderId);
      invalidateSortedCache(currentFolderId);
    }
  }, [currentFolderId, expandFolder, invalidateSortedCache]);

  useEffect(() => {
    if (!debouncedSearchQuery.trim() || !routeCollectionId) {
      setSearchResults([]);
      setIsSearching(false);
      lastCompletedSearchQueryRef.current = '';
      return;
    }

    setIsSearching(true);
    const performSearch = async (): Promise<void> => {
      try {
        const results = await searchCollectionItems(routeCollectionId, debouncedSearchQuery.trim());
        setSearchResults(results);
      } catch (error) {
        console.error('[FileBrowser] Search failed:', error);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
        lastCompletedSearchQueryRef.current = debouncedSearchQuery.trim();
      }
    };

    void performSearch();
  }, [debouncedSearchQuery, routeCollectionId]);

  const isCurrentFolderLoading = Boolean(currentFolderId && nodes[currentFolderId]?.isLoading);

  const sortSearchResults = useCallback(
    (items: CollectionChild[], option: SortOption | null): CollectionChild[] => {
      const sortOpt = option ?? { field: 'name' as SortField, order: 'asc' as SortOrder };
      return [...items].sort((a, b) => {
        if (a.type !== b.type) return a.type === 'FOLDER' ? -1 : 1;
        let comparison = 0;
        switch (sortOpt.field) {
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
        return sortOpt.order === 'asc' ? comparison : -comparison;
      });
    },
    [],
  );

  const files: CollectionChild[] = useMemo(() => {
    if (debouncedSearchQuery.trim()) {
      return sortSearchResults(searchResults, sortOption);
    }
    if (sortOption) {
      const sortedChildren = getSortedChildren(currentFolderId, sortOption);
      return sortedChildren.map(node => ({
        id: node.id,
        name: node.name,
        size: node.size,
        updatedAt: node.updatedAt,
        ingestionStatus: node.uploadStatus,
        type: node.type,
        mimeType: node.mimeType,
        parentId: node.parentId,
      }));
    } else {
      const children = getChildrenOf(currentFolderId);
      return children.map(node => ({
        id: node.id,
        name: node.name,
        size: node.size,
        updatedAt: node.updatedAt,
        ingestionStatus: node.uploadStatus,
        type: node.type,
        mimeType: node.mimeType,
        parentId: node.parentId,
      }));
    }
  }, [
    debouncedSearchQuery,
    searchResults,
    sortOption,
    sortSearchResults,
    getSortedChildren,
    getChildrenOf,
    currentFolderId,
  ]);

  const treeData = useMemo(() => {
    if (debouncedSearchQuery.trim()) return null;
    return getTreeData(
      routeCollectionId || undefined,
      collectionName || 'Collection',
      currentFolderId,
      sortOption ?? undefined,
    );
  }, [
    getTreeData,
    routeCollectionId,
    collectionName,
    debouncedSearchQuery,
    currentFolderId,
    sortOption,
  ]);

  const handleTreeNodeSelect = useCallback(
    (nodeId: string, type: NodeType) => {
      if (routeCollectionId && routeProjectId && routeChannelId && type === 'FILE') {
        const folder = routeFolderId || '_';
        void navigate(
          `/knowledge-base/${routeProjectId}/${routeChannelId}/${routeCollectionId}/${folder}/${nodeId}`,
        );
      }
    },
    [routeProjectId, routeChannelId, routeCollectionId, routeFolderId, navigate],
  );

  const handleFileCardClick = useCallback(
    (file: CollectionChild) => {
      if (!routeCollectionId || !routeProjectId || !routeChannelId) return;

      if (debouncedSearchQuery.trim()) {
        if (file.type === 'FILE') {
          const folder = file.parentId || '_';
          void hydrateAncestors(file.id, routeCollectionId);
          setSearchQuery('');
          void navigate(
            `/knowledge-base/${routeProjectId}/${routeChannelId}/${routeCollectionId}/${folder}/${file.id}`,
          );
        } else {
          setSearchQuery('');
          void navigate(
            `/knowledge-base/${routeProjectId}/${routeChannelId}/${routeCollectionId}/${file.id}`,
          );
        }
      } else {
        if (file.type === 'FOLDER') {
          void navigate(
            `/knowledge-base/${routeProjectId}/${routeChannelId}/${routeCollectionId}/${file.id}`,
          );
        } else {
          const folder = file.parentId || '_';
          void navigate(
            `/knowledge-base/${routeProjectId}/${routeChannelId}/${routeCollectionId}/${folder}/${file.id}`,
          );
        }
      }
    },
    [
      routeProjectId,
      routeChannelId,
      routeCollectionId,
      navigate,
      debouncedSearchQuery,
      setSearchQuery,
      hydrateAncestors,
    ],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      if (debouncedSearchQuery.trim()) return;
      setLocalViewMode(mode);
    },
    [debouncedSearchQuery],
  );

  const handleSortChange = useCallback((newSortOption: SortOption | null) => {
    setSortOption(newSortOption);
  }, []);

  const breadcrumbPath = useMemo(() => {
    if (!currentFolderId) return [];
    const path: Array<{ id: string; name: string }> = [];
    let currentId: string | null = currentFolderId;
    const visited = new Set<string>();
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodes[currentId] as CollectionTreeNode;
      if (node) {
        path.unshift({ id: node.id, name: node.name });
        currentId = node.parentId;
      } else {
        break;
      }
    }
    return path;
  }, [currentFolderId, nodes]);

  if (!routeCollectionId) {
    return (
      <div className='h-full flex items-center justify-center bg-white'>
        <div className='text-center'>
          <p className='text-gray-500 mb-2'>No collection selected</p>
          <p className='text-sm text-gray-400'>
            Select a collection from the sidebar to view files
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className='h-full flex flex-col bg-white'>
      <Header
        collectionId={routeCollectionId}
        {...(collectionName && { collectionName })}
        viewMode={localViewMode}
        onViewModeChange={handleViewModeChange}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortOption={sortOption}
        onSortChange={handleSortChange}
        onOpenChat={onOpenChat}
      />

      {routeCollectionId && collectionName && !debouncedSearchQuery.trim() && (
        <Breadcrumb
          rootItem={{ id: routeCollectionId, name: collectionName, type: 'FOLDER' as NodeType }}
          items={breadcrumbPath.map(item => ({
            id: item.id,
            name: item.name,
            type: 'FOLDER' as NodeType,
          }))}
          limit={10}
        />
      )}

      <div className='flex-1 overflow-hidden'>
        {isInitialLoading ? (
          <div className='flex items-center justify-center h-full'>
            <Loader2 size={24} className='text-blue-500 animate-spin' />
            <span className='ml-2 text-sm text-gray-500'>Loading files...</span>
          </div>
        ) : localViewMode === 'tree' ? (
          <div className='h-full overflow-auto p-4'>
            {treeData ? (
              <div className='py-2'>
                {treeData.children?.map(node => (
                  <TreeNode
                    key={node.id}
                    node={node}
                    selectedNodeId={null}
                    onSelect={handleTreeNodeSelect}
                    onToggle={folderId => {
                      void toggleFolder(folderId);
                      invalidateSortedCache(folderId);
                    }}
                    level={0}
                    variant='pill'
                  />
                ))}
              </div>
            ) : (
              <FileEmptyState />
            )}
          </div>
        ) : localViewMode === 'list' || debouncedSearchQuery.trim() ? (
          debouncedSearchQuery.trim() &&
          (isSearching || lastCompletedSearchQueryRef.current !== debouncedSearchQuery.trim()) ? (
            <div className='flex items-center justify-center h-full'>
              <Loader2 size={24} className='text-blue-500 animate-spin' />
              <span className='ml-2 text-sm text-gray-500'>Searching...</span>
            </div>
          ) : !debouncedSearchQuery.trim() && isCurrentFolderLoading ? (
            <div className='flex items-center justify-center h-full'>
              <Loader2 size={24} className='text-blue-500 animate-spin' />
              <span className='ml-2 text-sm text-gray-500'>Loading files...</span>
            </div>
          ) : files.length === 0 ? (
            debouncedSearchQuery.trim() ? (
              <SearchEmptyState query={debouncedSearchQuery.trim()} />
            ) : (
              <FileEmptyState />
            )
          ) : (
            <ListView files={files} onFileClick={handleFileCardClick} />
          )
        ) : isCurrentFolderLoading ? (
          <div className='flex items-center justify-center h-full'>
            <Loader2 size={24} className='text-blue-500 animate-spin' />
            <span className='ml-2 text-sm text-gray-500'>Loading files...</span>
          </div>
        ) : files.length === 0 ? (
          <FileEmptyState />
        ) : (
          <GridPanel files={files} onFileClick={handleFileCardClick} />
        )}
      </div>
    </div>
  );
};
