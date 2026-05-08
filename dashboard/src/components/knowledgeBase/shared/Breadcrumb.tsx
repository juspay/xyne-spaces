import React, { useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import Tooltip from '../../ui/Tooltip';
import { NodeType } from '../../../services/Knowledge/collectionService';
import { useCollectionTree, CollectionTreeNode } from '../context/CollectionTreeContext';

export interface BreadcrumbItem {
  id: string | null;
  name: string;
  type?: NodeType;
}

interface BreadcrumbProps {
  /** Root item (collection or "Root") */
  rootItem?: BreadcrumbItem;
  /** Collection name (used if rootItem not provided) */
  collectionName?: string;
  /** Path items (folders/files) */
  items?: BreadcrumbItem[];
  /** Callback when clicking a breadcrumb item */
  onNavigate?: (itemId: string | null) => void;
  /** Variant: 'default' (standard) or 'overlay' (file viewer with gradient) */
  variant?: 'default' | 'overlay';
  colortheme?: 'white' | 'dark';
  /** Custom className */
  className?: string;
  /** Maximum number of items to show from the end of the path. If provided and items exceed this limit, only the last N items will be shown with an ellipsis. */
  limit?: number;
}

/**
 * Unified Breadcrumb Component
 * Supports both standard and overlay (file viewer) styling
 * Used in FileListPanel, UploadModal, and FileViewerPanel
 */
export const Breadcrumb: React.FC<BreadcrumbProps> = ({
  rootItem,
  collectionName,
  items = [],
  onNavigate,
  variant = 'default',
  colortheme = 'white',
  className,
  limit,
}) => {
  const navigate = useNavigate();
  const { projectId, collectionId, folderId } = useParams<{
    projectId?: string;
    collectionId?: string;
    folderId?: string;
  }>();
  const { collapseFolder, nodes } = useCollectionTree();
  const isDarkMode = colortheme === 'dark';

  // All params come from URL path (both tree mode and viewer mode now use path params)
  const resolvedProjectId = projectId || null;
  const resolvedCollectionId = collectionId || null;
  // '_' is the sentinel for collection root
  const resolvedFolderId = folderId === '_' ? null : (folderId ?? null);

  const handleClick = (item: BreadcrumbItem | null): void => {
    if (onNavigate) {
      onNavigate(item?.id ?? null);
    } else {
      // Fallback navigation
      if (!resolvedCollectionId || !resolvedProjectId) return;
      if (item === null) {
        // Collapse all folders from current folderId to root
        if (resolvedFolderId) {
          let currentId: string | null = resolvedFolderId;
          while (currentId) {
            const node: CollectionTreeNode | undefined = nodes[currentId];
            if (node && node.type === 'FOLDER') {
              collapseFolder(currentId);
            }
            currentId = node?.parentId ?? null;
          }
        }
        void navigate(`/knowledge-base/${resolvedProjectId}/${resolvedCollectionId}`);
      } else if (item.type === 'FOLDER') {
        // Collapse all folders from current folderId up to (but not including) item.id
        if (resolvedFolderId && resolvedFolderId !== item.id && item.id) {
          let currentId: string | null = resolvedFolderId;
          const targetId = item.id;

          // Build path from current folderId up to target
          while (currentId && currentId !== targetId) {
            const node: CollectionTreeNode | undefined = nodes[currentId];
            if (node && node.type === 'FOLDER') {
              collapseFolder(currentId);
            }
            // Stop if we've reached the target or can't go further
            if (!node || !node.parentId) break;
            currentId = node.parentId;
          }
        }
        void navigate(`/knowledge-base/${resolvedProjectId}/${resolvedCollectionId}/${item.id}`);
      }
    }
  };

  // Determine root item
  const finalRootItem: BreadcrumbItem = rootItem || {
    id: resolvedCollectionId || null,
    name: collectionName || 'Collection',
    type: 'FOLDER',
  };

  // Apply limit to items - show only the last N items if limit is specified
  const displayItems = useMemo(() => {
    if (limit && items.length > limit) {
      return items.slice(-limit);
    }
    return items;
  }, [items, limit]);

  const hasTruncatedItems = limit && items.length > limit;

  // Overlay variant (file viewer)
  if (variant === 'overlay') {
    // Build the collection root path for overlay breadcrumb navigation
    const overlayCollectionPath =
      resolvedProjectId && resolvedCollectionId
        ? `/knowledge-base/${resolvedProjectId}/${resolvedCollectionId}`
        : '/knowledge-base';

    return (
      <div
        className={cn(
          'absolute bg-gradient-to-t from-black/60 to-transparent px-5 py-2 w-full bottom-0 left-0 z-20',
          className,
        )}
      >
        <nav className='flex items-center gap-2 text-sm'>
          <button
            onClick={() => {
              void navigate('/knowledge-base');
            }}
            data-track-category='knowledge-base'
            data-track-name='navigate-home'
            className='flex items-center gap-1 text-white/90 hover:text-white transition-colors drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'
          >
            <Home size={14} />
            <span>Knowledge Base</span>
          </button>

          {finalRootItem.name && (
            <>
              <ChevronRight size={14} className='text-white/70' />
              <button
                onClick={() => {
                  void navigate(overlayCollectionPath);
                }}
                data-track-category='knowledge-base'
                data-track-name='navigate-collection'
                className='text-white/90 hover:text-white transition-colors drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'
              >
                {finalRootItem.name}
              </button>
            </>
          )}

          {displayItems.length > 0 && (
            <>
              {hasTruncatedItems && (
                <>
                  <ChevronRight size={14} className='text-white/70' />
                  <span className='text-white/70 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'>...</span>
                </>
              )}
              {displayItems.map(item => (
                <React.Fragment key={item.id || 'item'}>
                  <ChevronRight size={14} className='text-white/70' />
                  <span className='text-white font-medium drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)]'>
                    {item.name}
                  </span>
                </React.Fragment>
              ))}
            </>
          )}
        </nav>
      </div>
    );
  }

  // Default variant (standard styling)
  return (
    <nav
      className={cn(
        'flex items-center gap-1 text-sm px-4 py-2 border-b',
        isDarkMode
          ? 'bg-gray-900 text-gray-300 border-gray-700'
          : 'bg-gray-50 text-gray-600 border-gray-200',
        className,
      )}
    >
      <Tooltip content={`Go to ${finalRootItem.name}`} side='top'>
        <button
          onClick={() => handleClick(null)}
          data-track-category='knowledge-base'
          data-track-name='navigate-root'
          className={cn(
            'flex items-center gap-1 transition-colors',
            isDarkMode ? 'hover:text-blue-400' : 'hover:text-blue-600',
          )}
        >
          <Home size={14} />
          <span className='font-medium'>{finalRootItem.name}</span>
        </button>
      </Tooltip>

      {displayItems.length > 0 && (
        <>
          {hasTruncatedItems && (
            <>
              <ChevronRight size={14} className={isDarkMode ? 'text-gray-500' : 'text-gray-400'} />
              <span className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}>...</span>
            </>
          )}
          {displayItems.map((item, index) => {
            const isLast = index === displayItems.length - 1;
            return (
              <React.Fragment key={item.id || `item-${index}`}>
                <ChevronRight
                  size={14}
                  className={isDarkMode ? 'text-gray-500' : 'text-gray-400'}
                />
                <Tooltip content={item.name} side='top'>
                  <button
                    onClick={() => !isLast && handleClick(item)}
                    data-track-category='knowledge-base'
                    data-track-name='navigate-breadcrumb'
                    className={cn(
                      'transition-colors truncate max-w-[150px]',
                      isLast
                        ? cn(
                            'font-medium cursor-default',
                            isDarkMode ? 'text-gray-100' : 'text-gray-900',
                          )
                        : cn(
                            'cursor-pointer',
                            isDarkMode
                              ? 'text-gray-300 hover:text-blue-400'
                              : 'text-gray-600 hover:text-blue-600',
                          ),
                    )}
                    disabled={isLast}
                  >
                    {item.name}
                  </button>
                </Tooltip>
              </React.Fragment>
            );
          })}
        </>
      )}
    </nav>
  );
};
