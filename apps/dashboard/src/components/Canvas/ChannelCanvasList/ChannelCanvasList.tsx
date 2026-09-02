import React, { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Folder, Plus, Search } from 'lucide-react';
import type { Canvas, CanvasFolder } from '../Canvas.types';
import Input from '../../ui/Input';
import { Button } from '../../ui/Button/Button';
import { Dialog } from '../../ui/Dialog';
import { CanvasDeleteModal } from '../CanvasDeleteModal';
import { CanvasRow } from '../CanvasRow';
import { getDisplayedCanvases } from '../canvasListFilters';
import { filterStarredCanvases, withStarredCanvasState } from '../canvasFilters';
import { DelayedSpinner } from '../../ui/DelayedSpinner';

type FilterTab = 'all' | 'created_by_me' | 'shared';

const channelCanvasRowTrackNames = {
  canvasOpen: 'Open_Canvas_Channel_Grouped',
  actionsMenu: 'CHANNEL_CANVAS_ACTIONS_MENU',
} as const;

interface FolderGroup {
  folder: CanvasFolder;
  canvases: Canvas[];
}

interface ChannelCanvasListProps {
  canvases: Canvas[];
  // True while the canvases query is still resolving; gates the empty state.
  loading?: boolean;
  folders: CanvasFolder[];
  activeFilter: FilterTab;
  onFilterChange: (filter: FilterTab) => void;
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  currentUserId?: string | undefined;
  selectedCanvasId?: string | undefined;
  onDelete?: (id: string) => void;
  onArchiveToggle?: (canvas: Canvas) => void;
  onCreateCanvasInFolder?: (folder: CanvasFolder) => void;
  isCreatingCanvas?: boolean;
  showStarredOnly?: boolean;
  onToggleStar?: (canvas: Canvas) => void;
}

function sortByName<T>(items: T[], getName: (item: T) => string): T[] {
  return [...items].sort((a, b) => getName(a).localeCompare(getName(b)));
}

export const ChannelCanvasList: React.FC<ChannelCanvasListProps> = ({
  canvases,
  folders,
  activeFilter,
  onFilterChange,
  onSelect,
  currentUserId,
  selectedCanvasId,
  onDelete,
  onArchiveToggle,
  onCreateCanvasInFolder,
  isCreatingCanvas = false,
  showStarredOnly = false,
  onToggleStar,
  loading = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [deletingCanvas, setDeletingCanvas] = useState<Canvas | null>(null);

  const canvasesWithStarState = useMemo(() => withStarredCanvasState(canvases), [canvases]);

  const displayedCanvases = useMemo(
    () =>
      filterStarredCanvases(
        getDisplayedCanvases({
          canvases: canvasesWithStarState,
          activeFilter,
          currentUserId,
          searchQuery,
        }),
        showStarredOnly,
      ),
    [activeFilter, canvasesWithStarState, currentUserId, searchQuery, showStarredOnly],
  );

  const displayedFolders = useMemo(() => {
    if (searchQuery.trim()) return [];
    return folders;
  }, [folders, searchQuery]);

  const { folderGroups, rootCanvases } = useMemo(() => {
    const groups = new Map<string, FolderGroup>();
    const hasContentFilter = activeFilter !== 'all' || showStarredOnly;

    for (const folder of displayedFolders) {
      groups.set(folder.id, { folder, canvases: [] });
    }

    const root: Canvas[] = [];
    for (const canvas of displayedCanvases) {
      if (canvas.folderId && groups.has(canvas.folderId)) {
        groups.get(canvas.folderId)?.canvases.push(canvas);
        continue;
      }
      root.push(canvas);
    }

    return {
      folderGroups: sortByName(Array.from(groups.values()), group => group.folder.name)
        .map(group => ({
          ...group,
          canvases: sortByName(group.canvases, canvas => canvas.title || 'Untitled'),
        }))
        .filter(group => !hasContentFilter || group.canvases.length > 0),
      rootCanvases: sortByName(root, canvas => canvas.title || 'Untitled'),
    };
  }, [activeFilter, displayedCanvases, displayedFolders, showStarredOnly]);

  const isEmpty = folderGroups.length === 0 && rootCanvases.length === 0;

  const toggleFolder = (id: string): void => {
    setCollapsedFolders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <>
      <div
        className='flex flex-col h-full bg-background'
        data-testid='canvas-list'
        data-component='channel-canvas-list'
      >
        <div className='px-4 md:px-6 py-4 border-b border-border'>
          <div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0'>
            <div className='flex items-center gap-2'>
              <button
                onClick={() => onFilterChange('all')}
                className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
                  activeFilter === 'all'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                data-testid='canvas-filter-all'
                data-track-category='CANVAS'
                data-track-name='Filter_Channel_Canvases_All'
              >
                All
              </button>
              <button
                onClick={() => onFilterChange('created_by_me')}
                className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
                  activeFilter === 'created_by_me'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                data-testid='canvas-filter-created-by-me'
                data-track-category='CANVAS'
                data-track-name='Filter_Channel_Canvases_Created_By_Me'
              >
                Created by me
              </button>
              <button
                onClick={() => onFilterChange('shared')}
                className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
                  activeFilter === 'shared'
                    ? 'bg-muted text-foreground'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                data-testid='canvas-filter-shared'
                data-track-category='CANVAS'
                data-track-name='Filter_Channel_Canvases_Shared'
              >
                Shared
              </button>
            </div>

            <div className='relative w-full sm:w-auto'>
              <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground' />
              <Input
                type='text'
                value={searchQuery}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setSearchQuery(e.target.value)
                }
                placeholder='Search canvases'
                className='pl-9 w-full sm:w-48 md:w-64'
              />
            </div>
          </div>
        </div>

        <div className='flex-1 overflow-auto'>
          {loading ? (
            <DelayedSpinner className='flex h-full items-center justify-center' />
          ) : isEmpty ? (
            <div className='flex flex-col items-center justify-center h-full text-center py-16'>
              <FileText className='w-16 h-16 text-muted-foreground mb-4' />
              <h3 className='text-lg font-medium text-foreground mb-2'>
                {searchQuery ? 'No canvases found' : 'No canvases yet'}
              </h3>
              <p className='text-muted-foreground text-sm'>
                {searchQuery ? 'Try a different search' : 'Create your first canvas to get started'}
              </p>
            </div>
          ) : searchQuery.trim() ? (
            <div className='p-2 space-y-0.5'>
              {displayedCanvases.map(canvas => (
                <CanvasRow
                  key={canvas.id}
                  canvas={canvas}
                  indentClassName='pl-2'
                  onSelect={onSelect}
                  selectedCanvasId={selectedCanvasId}
                  currentUserId={currentUserId}
                  trackNames={channelCanvasRowTrackNames}
                  onToggleStar={onToggleStar}
                  onArchiveToggle={onArchiveToggle}
                  onDelete={
                    onDelete
                      ? (id): void => {
                          const targetCanvas = canvases.find(item => item.id === id) ?? null;
                          if (targetCanvas) setDeletingCanvas(targetCanvas);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <div className='p-2 space-y-1'>
              {folderGroups.map(folderGroup => {
                const isCollapsed = collapsedFolders.has(folderGroup.folder.id);
                return (
                  <section key={folderGroup.folder.id}>
                    <div className='flex items-center group pl-2 pr-2 py-1.5 hover:bg-accent rounded-md'>
                      <button
                        className='flex min-w-0 flex-1 items-center gap-2 text-left'
                        onClick={() => toggleFolder(folderGroup.folder.id)}
                        data-track-category='CANVAS'
                        data-track-name='Toggle_Channel_Folder'
                      >
                        {isCollapsed ? (
                          <ChevronRight className='w-3.5 h-3.5 text-muted-foreground shrink-0' />
                        ) : (
                          <ChevronDown className='w-3.5 h-3.5 text-muted-foreground shrink-0' />
                        )}
                        <Folder className='w-3.5 h-3.5 text-amber-500 shrink-0' />
                        <span className='text-sm truncate'>{folderGroup.folder.name}</span>
                        <span className='ml-auto text-xs text-muted-foreground'>
                          {folderGroup.canvases.length}
                        </span>
                      </button>
                      {onCreateCanvasInFolder && (
                        <Button
                          variant='ghost'
                          className='p-1 opacity-70 group-hover:opacity-100 hover:bg-muted rounded transition-all disabled:opacity-40'
                          onClick={() => onCreateCanvasInFolder(folderGroup.folder)}
                          disabled={isCreatingCanvas}
                          title='Create canvas in folder'
                          data-testid={`channel-folder-create-canvas-${folderGroup.folder.id}`}
                          trackId='create_canvas_in_channel_folder'
                          data-track-category='CANVAS'
                          data-track-name='Create_Canvas_In_Channel_Folder'
                        >
                          <Plus className='w-4 h-4 text-muted-foreground' />
                        </Button>
                      )}
                    </div>
                    {!isCollapsed &&
                      folderGroup.canvases.map(canvas => (
                        <CanvasRow
                          key={canvas.id}
                          canvas={canvas}
                          indentClassName='pl-6'
                          onSelect={onSelect}
                          selectedCanvasId={selectedCanvasId}
                          currentUserId={currentUserId}
                          trackNames={channelCanvasRowTrackNames}
                          onToggleStar={onToggleStar}
                          onArchiveToggle={onArchiveToggle}
                          onDelete={
                            onDelete
                              ? (id): void => {
                                  const targetCanvas =
                                    canvases.find(item => item.id === id) ?? null;
                                  if (targetCanvas) setDeletingCanvas(targetCanvas);
                                }
                              : undefined
                          }
                        />
                      ))}
                  </section>
                );
              })}

              {rootCanvases.map(canvas => (
                <CanvasRow
                  key={canvas.id}
                  canvas={canvas}
                  indentClassName='pl-2'
                  onSelect={onSelect}
                  selectedCanvasId={selectedCanvasId}
                  currentUserId={currentUserId}
                  trackNames={channelCanvasRowTrackNames}
                  onToggleStar={onToggleStar}
                  onArchiveToggle={onArchiveToggle}
                  onDelete={
                    onDelete
                      ? (id): void => {
                          const targetCanvas = canvases.find(item => item.id === id) ?? null;
                          if (targetCanvas) setDeletingCanvas(targetCanvas);
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={!!deletingCanvas}
        onOpenChange={open => !open && setDeletingCanvas(null)}
        title='Delete Canvas'
      >
        <CanvasDeleteModal
          onClose={() => setDeletingCanvas(null)}
          onConfirm={() => {
            if (deletingCanvas && onDelete) {
              onDelete(deletingCanvas.id);
              setDeletingCanvas(null);
            }
          }}
          canvasTitle={deletingCanvas?.title}
        />
      </Dialog>
    </>
  );
};
