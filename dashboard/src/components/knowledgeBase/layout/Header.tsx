import React, { useState, useRef, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Grid,
  FolderTree,
  List,
  Search,
  X,
  Folders,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Check,
  AlertCircle,
  MapPin,
} from 'lucide-react';
import { XyneAIStar } from '../../icons/xyne-ai';
import { UploadModal } from '../upload/UploadModal';
import { UploadButton } from '../upload/UploadButton';
import { cn } from '../../../utils/classNames';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import Dialog from '../../ui/Dialog';
import { Button } from '../../ui/Button';
import Tooltip from '../../ui/Tooltip';
import { useProjectCollections } from '../hooks/useProjectCollections';
import { useCollectionMutations } from '../hooks/useCollectionMutations';

export type ViewMode = 'grid' | 'tree' | 'list';
export type SortField = 'name' | 'date' | 'size';
export type SortOrder = 'asc' | 'desc';

export interface SortOption {
  field: SortField;
  order: SortOrder;
}

interface HeaderProps {
  collectionId: string | null;
  collectionName?: string | undefined;
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
  searchQuery: string;
  onSearchChange: (query: string) => void;
  sortOption?: SortOption | null;
  onSortChange?: (sort: SortOption | null) => void;
  onOpenChat?: ((docId?: string, docName?: string) => void) | undefined;
}

export const Header: React.FC<HeaderProps> = ({
  collectionId,
  collectionName,
  viewMode,
  onViewModeChange,
  searchQuery,
  onSearchChange,
  sortOption,
  onSortChange,
  onOpenChat,
}) => {
  const navigate = useNavigate();
  const params = useParams<{ projectId?: string; channelId?: string; folderId?: string }>();
  const projectId = params.projectId ?? null;
  const channelId = params.channelId ?? null;
  const folderId = params.folderId ?? null;
  const { activeCollection, failedItems } = useProjectCollections();
  const { hydrateAncestors } = useCollectionMutations();
  const [showUpload, setShowUpload] = useState(false);
  const [showFailedIngestWarning, setShowFailedIngestWarning] = useState(false);
  const [showProcessingWarning, setShowProcessingWarning] = useState(false);
  const [processingCounts, setProcessingCounts] = useState<{
    pending: number;
    processing: number;
    total: number;
  } | null>(null);
  const [isSearchExpanded, setIsSearchExpanded] = useState(!!searchQuery);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const handleAskAIClick = () => {
    if (failedItems.length > 0) {
      setShowFailedIngestWarning(true);
      return;
    }
    onOpenChat?.();
  };

  const canUpload =
    !activeCollection?.role ||
    activeCollection.role === 'EDITOR' ||
    activeCollection.role === 'OWNER';

  useEffect(() => {
    if (isSearchExpanded && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [isSearchExpanded]);

  useEffect(() => {
    if (searchQuery && !isSearchExpanded) {
      setIsSearchExpanded(true);
    }
  }, [searchQuery]);

  const handleSearchIconClick = () => {
    setIsSearchExpanded(true);
  };

  const handleSearchClose = () => {
    setIsSearchExpanded(false);
    onSearchChange('');
  };

  const handleSort = (field: SortField | null) => {
    if (!onSortChange) return;

    if (field === null) {
      onSortChange(null);
      return;
    }

    if (sortOption?.field === field) {
      onSortChange({
        field,
        order: sortOption.order === 'asc' ? 'desc' : 'asc',
      });
    } else {
      onSortChange({ field, order: 'asc' });
    }
  };

  const getSortIcon = (field: SortField) => {
    if (!sortOption || sortOption.field !== field) {
      return <ArrowUpDown size={14} className='text-gray-400' />;
    }
    return sortOption.order === 'asc' ? (
      <ArrowUp size={14} className='text-blue-600' />
    ) : (
      <ArrowDown size={14} className='text-blue-600' />
    );
  };

  return (
    <>
      <div className='px-4 py-3 border-b bg-gray-50'>
        <div className='flex items-center justify-between gap-4 mb-1'>
          <div className='flex items-center gap-2 flex-shrink-0'>
            <Folders size={18} className='text-gray-600' />
            <h2 className='text-lg font-semibold text-gray-900'>
              {collectionName ? collectionName : 'Select a Collection'}
            </h2>
          </div>

          {collectionId && (
            <div className='flex items-center gap-2'>
              <div className='flex items-center gap-2 rounded-full border border-gray-200 bg-white p-1.5 shadow-sm w-fit'>
                {/* View Mode Toggle */}
                <div className='flex items-center gap-1 transition-all duration-300 ease-in-out overflow-hidden w-auto opacity-100'>
                  <Tooltip content='List View' side='top'>
                    <button
                      onClick={() => onViewModeChange('list')}
                      data-track-category='knowledge-base'
                      data-track-name='view-mode-list'
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-all duration-200 whitespace-nowrap',
                        viewMode === 'list'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-gray-600 hover:bg-gray-100',
                      )}
                    >
                      <List size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content='Grid View' side='top'>
                    <button
                      onClick={() => onViewModeChange('grid')}
                      data-track-category='knowledge-base'
                      data-track-name='view-mode-grid'
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-all duration-200 whitespace-nowrap',
                        viewMode === 'grid'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-gray-600 hover:bg-gray-100',
                      )}
                    >
                      <Grid size={16} />
                    </button>
                  </Tooltip>
                  <Tooltip content='Tree View' side='top'>
                    <button
                      onClick={() => onViewModeChange('tree')}
                      data-track-category='knowledge-base'
                      data-track-name='view-mode-tree'
                      className={cn(
                        'flex items-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium transition-all duration-200 whitespace-nowrap',
                        viewMode === 'tree'
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-gray-600 hover:bg-gray-100',
                      )}
                    >
                      <FolderTree size={16} />
                    </button>
                  </Tooltip>
                </div>
              </div>

              <div className='flex items-center gap-2 rounded-full border border-gray-200 bg-white p-1 shadow-sm w-fit'>
                {/* Search area */}
                <div className='flex items-center'>
                  <div
                    className={cn(
                      'flex items-center overflow-hidden transition-all duration-300 ease-in-out',
                      isSearchExpanded ? 'w-64' : 'w-0',
                    )}
                  >
                    <input
                      ref={searchInputRef}
                      type='text'
                      placeholder='Search files in this collection...'
                      value={searchQuery}
                      data-track-category='knowledge-base'
                      data-track-name='search-files'
                      onChange={e => onSearchChange(e.target.value)}
                      className='h-9 w-full bg-transparent px-3 text-sm text-gray-900 placeholder:text-gray-400 outline-none'
                    />
                    <button
                      onClick={handleSearchClose}
                      data-track-category='knowledge-base'
                      data-track-name='close-search'
                      className={cn(
                        'flex-shrink-0 rounded-lg p-2 text-gray-600 transition-colors duration-200',
                        !isSearchExpanded && 'hidden',
                      )}
                    >
                      <X size={16} />
                    </button>
                  </div>

                  <button
                    onClick={handleSearchIconClick}
                    data-track-category='knowledge-base'
                    data-track-name='open-search'
                    className={cn(
                      'flex-shrink-0 rounded-lg p-2 text-gray-600 transition-all duration-300',
                      isSearchExpanded && 'hidden',
                    )}
                  >
                    <Search size={16} />
                  </button>
                </div>
              </div>

              {/* Sort Dropdown */}
              {onSortChange && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button className='flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-3 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors'>
                      <ArrowUpDown size={16} />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-48'>
                    <DropdownMenuItem
                      onClick={() => handleSort(null)}
                      className={cn(
                        'flex items-center justify-between cursor-pointer',
                        !sortOption && 'bg-gray-50',
                      )}
                    >
                      <span>None</span>
                      {!sortOption && <Check size={14} className='text-blue-600' />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleSort('name')}
                      className='flex items-center justify-between cursor-pointer'
                    >
                      <span>Name</span>
                      {getSortIcon('name')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleSort('date')}
                      className='flex items-center justify-between cursor-pointer'
                    >
                      <span>Date modified</span>
                      {getSortIcon('date')}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => handleSort('size')}
                      className='flex items-center justify-between cursor-pointer'
                    >
                      <span>File size</span>
                      {getSortIcon('size')}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {canUpload && (
                <div className='flex items-center rounded-full border border-gray-200 bg-white p-1.5 shadow-sm'>
                  <UploadButton onClick={() => setShowUpload(true)} />
                </div>
              )}

              {/* Failed uploads dropdown - only when there are failed items */}
              {failedItems.length > 0 && (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <button className='relative flex items-center gap-1.5 rounded-full border border-gray-200 bg-white px-3 py-3 text-sm font-medium text-gray-600 shadow-sm hover:bg-gray-50 transition-colors'>
                      <AlertCircle size={16} className='text-amber-600' />
                      <span className='absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] font-semibold text-white'>
                        {failedItems.length}
                      </span>
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align='end' className='w-80 max-h-[320px] overflow-y-auto'>
                    <div className='py-1'>
                      {failedItems.map(item => (
                        <div
                          key={item.id}
                          className='flex items-center justify-between gap-2 px-3 py-2 hover:bg-gray-50 rounded-sm group'
                        >
                          <Tooltip content={item.name} side='top'>
                            <span className='text-sm text-gray-800 truncate flex-1 block'>
                              {item.name}
                            </span>
                          </Tooltip>
                          <button
                            type='button'
                            data-track-category='knowledge-base'
                            data-track-name='navigate-to-location'
                            onClick={() => {
                              if (projectId && channelId && collectionId) {
                                const folder = item.parentId || '_';
                                void hydrateAncestors(item.id, collectionId);
                                void navigate(
                                  `/knowledge-base/${projectId}/${channelId}/${collectionId}/${folder}/${item.id}`,
                                );
                              }
                            }}
                            className='flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700 shrink-0'
                          >
                            <MapPin size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}

              {/* AI Chat Button */}
              {onOpenChat && (
                <>
                  <Tooltip
                    content={`Ask AI about this ${folderId ? 'folder' : 'collection'}`}
                    side='top'
                  >
                    <button
                      onClick={() => {
                        void handleAskAIClick();
                      }}
                      data-track-category='knowledge-base'
                      data-track-name='open-ai-chat'
                      className='flex items-center justify-center rounded-lg border border-gray-200 bg-white p-2 text-gray-600 shadow-sm transition-all duration-100 hover:bg-gray-50'
                    >
                      <XyneAIStar />
                    </button>
                  </Tooltip>
                  <Dialog
                    open={showFailedIngestWarning}
                    onOpenChange={setShowFailedIngestWarning}
                    title='Some files failed to ingest'
                    description='Files in this collection that failed to ingest might not be available for AI.'
                  >
                    <div className='p-6'>
                      <p className='text-sm text-gray-600 mb-4'>
                        {failedItems.length} file{failedItems.length !== 1 ? 's' : ''} in this
                        collection failed to ingest (embed) and might not be available for AI. Do
                        you still want to continue?
                      </p>
                      <div className='flex justify-end gap-2'>
                        <Button
                          variant='outline'
                          className='px-4 py-2 border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                          onClick={() => setShowFailedIngestWarning(false)}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant='default'
                          className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                          onClick={() => {
                            setShowFailedIngestWarning(false);
                            onOpenChat?.();
                          }}
                        >
                          Continue
                        </Button>
                      </div>
                    </div>
                  </Dialog>
                  <Dialog
                    open={showProcessingWarning}
                    onOpenChange={open => {
                      setShowProcessingWarning(open);
                      if (!open) setProcessingCounts(null);
                    }}
                    title='Files still processing'
                    description='Some files in this folder are still being embedded.'
                  >
                    <div className='p-6'>
                      <p className='text-sm text-gray-600 mb-4'>
                        {processingCounts ? (
                          <>
                            <span className='font-medium text-gray-900'>
                              {processingCounts.pending + processingCounts.processing} of{' '}
                              {processingCounts.total} file
                              {processingCounts.total !== 1 ? 's' : ''}
                            </span>{' '}
                            are still processing (embedding) and might not be available for AI. Do
                            you still want to continue?
                          </>
                        ) : (
                          'Some files are still processing (embedding) and might not be available for AI. Do you still want to continue?'
                        )}
                      </p>
                      <div className='flex justify-end gap-2'>
                        <Button
                          variant='outline'
                          className='px-4 py-2 border-gray-300 rounded-lg text-gray-600 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                          onClick={() => {
                            setShowProcessingWarning(false);
                            setProcessingCounts(null);
                          }}
                        >
                          Cancel
                        </Button>
                        <Button
                          variant='default'
                          className='px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                          onClick={() => {
                            setShowProcessingWarning(false);
                            setProcessingCounts(null);
                            onOpenChat?.();
                          }}
                        >
                          Continue
                        </Button>
                      </div>
                    </div>
                  </Dialog>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Upload Modal */}
      {collectionId && (
        <UploadModal
          isOpen={showUpload}
          onClose={() => setShowUpload(false)}
          collectionId={collectionId}
          {...(collectionName && { collectionName })}
          onUploadComplete={() => setShowUpload(false)}
        />
      )}
    </>
  );
};
