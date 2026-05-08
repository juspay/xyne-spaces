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
  CollectionRole,
  NodeType,
  searchCollectionItems,
} from '../../../services/Knowledge/collectionService';
import { useCollectionTree, CollectionTreeNode } from '../context/CollectionTreeContext';
import { Breadcrumb } from '../shared/Breadcrumb';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';

interface FileBrowserProps {
  selectedCollectionId: string | null;
  collectionName: string | undefined;
  collectionRole: CollectionRole | undefined;
  onOpenChat?: ((docId?: string, docName?: string) => void) | undefined;
}

/**
 * File Browser Wrapper Component
 * Reads tree data from CollectionTreeContext (no own API calls).
 * Handles header, view mode toggle, and renders either
 * FileListPanel (list view) or VirtualTree (tree view).
 */
export const FileBrowser: React.FC<FileBrowserProps> = ({
  selectedCollectionId,
  collectionName,
  onOpenChat,
}) => {
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string; collectionId?: string; folderId?: string }>();

  // Shared tree context
  const {
    isInitialLoading,
    getTreeData,
    getSortedChildren,
    getChildrenOf,
    toggleFolder,
    expandFolder,
    setViewMode,
    currentFolderId,
    setCurrentFolderId,
    nodes,
    hydrateAncestors,
  } = useCollectionTree();

  // localStorage keys for persisting state
  const STORAGE_KEY_VIEW_MODE = 'kb_file_browser_view_mode';
  const STORAGE_KEY_SEARCH_QUERY = 'kb_file_browser_search_query';
  const STORAGE_KEY_SORT_OPTION = 'kb_file_browser_sort_option';

  // Initialize local view mode from context (kept in sync)
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

  // Debounce search query (300ms delay)
  const debouncedSearchQuery = useDebouncedValue(searchQuery, 300);

  // Search results state
  const [searchResults, setSearchResults] = useState<CollectionChild[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  // Ref: last debounced query we finished searching for (so we show loading until results match current query)
  const lastCompletedSearchQueryRef = useRef<string>('');

  // Initialize sort option from localStorage
  const [sortOption, setSortOption] = useState<SortOption | null>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY_SORT_OPTION);
      if (saved) {
        // Check if it's the special "none" value
        if (saved === 'null') {
          return null;
        }
        const parsed = JSON.parse(saved) as SortOption;
        if (parsed.field && parsed.order) {
          return parsed;
        }
      }
    } catch {
      // Ignore parse errors
    }
    return null; // Default to no sorting
  });

  // Sync local view mode → context view mode
  useEffect(() => {
    setViewMode(localViewMode);
  }, [localViewMode, setViewMode]);

  // Automatically switch to list mode when searching
  useEffect(() => {
    if (debouncedSearchQuery.trim() && localViewMode !== 'list') {
      setLocalViewMode('list');
    }
  }, [debouncedSearchQuery, localViewMode]);

  // Persist viewMode to localStorage when it changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY_VIEW_MODE, localViewMode);
    } catch {
      // Failed to save, ignore silently
    }
  }, [localViewMode]);

  // Persist searchQuery to localStorage when it changes
  useEffect(() => {
    try {
      if (searchQuery) {
        localStorage.setItem(STORAGE_KEY_SEARCH_QUERY, searchQuery);
      } else {
        localStorage.removeItem(STORAGE_KEY_SEARCH_QUERY);
      }
    } catch {
      // Failed to save, ignore silently
    }
  }, [searchQuery]);

  // Persist sortOption to localStorage when it changes
  useEffect(() => {
    try {
      if (sortOption === null) {
        localStorage.setItem(STORAGE_KEY_SORT_OPTION, 'null');
      } else {
        localStorage.setItem(STORAGE_KEY_SORT_OPTION, JSON.stringify(sortOption));
      }
    } catch {
      // Failed to save, ignore silently
    }
  }, [sortOption]);

  // Get current folderId from route (null for root)
  // '_' is the sentinel for collection root
  const rawRouteFolderId = params.folderId || null;
  const routeFolderId = rawRouteFolderId === '_' ? null : rawRouteFolderId;
  const routeProjectId = params.projectId || null;
  const routeCollectionId = params.collectionId || selectedCollectionId;

  // ── Phase 2: Sync route folderId → context ──
  useEffect(() => {
    setCurrentFolderId(routeFolderId);
  }, [routeFolderId, setCurrentFolderId]);

  // Ensure current folder's children are loaded when navigating or switching views
  useEffect(() => {
    if (currentFolderId) {
      void expandFolder(currentFolderId);
    }
  }, [currentFolderId, expandFolder]);

  // Perform search only when query or collection changes (not when sortOption changes)
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

  // ── Derived data from context ──

  // Show loader when viewing a folder whose children are still being fetched (e.g. after clicking into it)
  const isCurrentFolderLoading = Boolean(currentFolderId && nodes[currentFolderId]?.isLoading);

  // Helper: sort CollectionChild[] by current sort option (folders first, then by field)
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

  // Convert context children to CollectionChild[] for FileListPanel
  // Uses sorted children from context (cached) or unsorted if sortOption is null
  const files: CollectionChild[] = useMemo(() => {
    // When searching, use raw search results and sort client-side (no API call on sort change)
    if (debouncedSearchQuery.trim()) {
      return sortSearchResults(searchResults, sortOption);
    }

    // When not searching, get children from context
    if (sortOption) {
      // Use sorted children if sort option is provided
      const sortedChildren = getSortedChildren(currentFolderId, sortOption);
      return sortedChildren.map(node => ({
        id: node.id,
        name: node.name,
        size: node.size,
        updatedAt: node.updatedAt,
        uploadStatus: node.uploadStatus,
        type: node.type,
        mimeType: node.mimeType,
        parentId: node.parentId,
        metadata: node.metadata,
      }));
    } else {
      // Use unsorted children if no sort option
      const children = getChildrenOf(currentFolderId);
      return children.map(node => ({
        id: node.id,
        name: node.name,
        size: node.size,
        updatedAt: node.updatedAt,
        uploadStatus: node.uploadStatus,
        type: node.type,
        mimeType: node.mimeType,
        parentId: node.parentId,
        metadata: node.metadata,
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

  // Tree data for tree view (from context, already sorted)
  // Note: When searching, we don't use tree view - always show list view
  const treeData = useMemo(() => {
    // Don't build tree data when searching - search results always show in list mode
    if (debouncedSearchQuery.trim()) {
      return null;
    }
    // Get tree data from context (normal mode only, no search)
    return getTreeData(
      routeCollectionId || undefined,
      collectionName || 'Collection',
      currentFolderId, // Start from current folder's children (folder itself not shown)
      sortOption ?? undefined, // Pass sort option to context (convert null to undefined)
    );
  }, [
    getTreeData,
    routeCollectionId,
    collectionName,
    debouncedSearchQuery,
    currentFolderId,
    sortOption,
  ]);

  // ── Handlers ──

  const handleTreeNodeSelect = useCallback(
    (nodeId: string, type: NodeType) => {
      // In tree view, only navigate to file viewer for files
      if (routeCollectionId && routeProjectId && type === 'FILE') {
        const folder = routeFolderId || '_'; // '_' = collection root
        void navigate(`/knowledge-base/${routeProjectId}/${routeCollectionId}/${folder}/${nodeId}`);
      }
    },
    [routeProjectId, routeCollectionId, routeFolderId, navigate],
  );

  const handleFileCardClick = useCallback(
    (file: CollectionChild) => {
      if (!routeCollectionId || !routeProjectId) return;

      // If in search mode
      if (debouncedSearchQuery.trim()) {
        if (file.type === 'FILE') {
          const folder = file.parentId || '_';
          void hydrateAncestors(file.id, routeCollectionId);
          setSearchQuery('');
          void navigate(
            `/knowledge-base/${routeProjectId}/${routeCollectionId}/${folder}/${file.id}`,
          );
        } else {
          setSearchQuery('');
          void navigate(`/knowledge-base/${routeProjectId}/${routeCollectionId}/${file.id}`);
        }
      } else {
        // Normal navigation (not in search mode)
        if (file.type === 'FOLDER') {
          void navigate(`/knowledge-base/${routeProjectId}/${routeCollectionId}/${file.id}`);
        } else {
          // Navigate to file viewer
          const folder = file.parentId || '_'; // '_' = collection root
          void navigate(
            `/knowledge-base/${routeProjectId}/${routeCollectionId}/${folder}/${file.id}`,
          );
        }
      }
    },
    [routeProjectId, routeCollectionId, navigate, debouncedSearchQuery, setSearchQuery],
  );

  const handleViewModeChange = useCallback(
    (mode: ViewMode) => {
      // Prevent view mode changes when searching - search always shows in list mode
      if (debouncedSearchQuery.trim()) {
        return;
      }
      setLocalViewMode(mode);
    },
    [debouncedSearchQuery],
  );

  const handleSortChange = useCallback((newSortOption: SortOption | null) => {
    setSortOption(newSortOption);
  }, []);

  // Build breadcrumb path from context nodes
  const breadcrumbPath = useMemo(() => {
    if (!currentFolderId) {
      return [];
    }

    const path: Array<{ id: string; name: string }> = [];
    let currentId: string | null = currentFolderId;
    const visited = new Set<string>();

    // Build path by traversing up parentId chain using context nodes
    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);
      const node = nodes[currentId] as CollectionTreeNode;
      if (node) {
        path.unshift({ id: node.id, name: node.name });
        currentId = node.parentId;
      } else {
        // Node not found in context - break to avoid infinite loop
        break;
      }
    }

    return path;
  }, [currentFolderId, nodes]);

  // ── Render ──

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

      {/* Breadcrumb - shown in both list and tree views */}
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

      {/* Content Area - Switch between Grid, List, and Tree views */}
      <div className='flex-1 overflow-hidden'>
        {isInitialLoading ? (
          <div className='flex items-center justify-center h-full'>
            <Loader2 size={24} className='text-blue-500 animate-spin' />
            <span className='ml-2 text-sm text-gray-500'>Loading files...</span>
          </div>
        ) : localViewMode === 'tree' ? (
          // Tree View (reads from context via getTreeData)
          // Note: When searching, this won't render because we auto-switch to list mode
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
          // List View - table format (always used when searching)
          // Show loading when we have a search query but results aren't for this query yet (avoids empty-state flash)
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
          // Grid View - folder contents loading
          <div className='flex items-center justify-center h-full'>
            <Loader2 size={24} className='text-blue-500 animate-spin' />
            <span className='ml-2 text-sm text-gray-500'>Loading files...</span>
          </div>
        ) : files.length === 0 ? (
          // Grid View - empty state
          <FileEmptyState />
        ) : (
          // Grid View - shows current folder's children
          <GridPanel files={files} onFileClick={handleFileCardClick} />
        )}
      </div>
    </div>
  );
};
