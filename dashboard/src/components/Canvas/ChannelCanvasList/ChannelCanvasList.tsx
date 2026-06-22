import React, { useMemo, useState } from 'react';
import {
  BookMarked,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  Plus,
  Search,
} from 'lucide-react';
import type { Canvas, CanvasFolder } from '../Canvas.types';
import Input from '../../ui/Input';
import { Dialog } from '../../ui/Dialog';
import { CanvasDeleteModal } from '../CanvasDeleteModal';
import { CanvasRow } from '../CanvasRow';
import { getDisplayedCanvases } from '../canvasListFilters';
import { filterStarredCanvases, withStarredCanvasState } from '../canvasFilters';

type FilterTab = 'all' | 'created_by_me' | 'quarto_docs';

const channelCanvasRowTrackNames = {
  canvasOpen: 'Open_Canvas_Channel_Grouped',
  quartoDocOpen: 'Open_Quarto_Doc_Channel_Grouped',
  actionsMenu: 'CHANNEL_CANVAS_ACTIONS_MENU',
} as const;

interface FolderGroup {
  folder: CanvasFolder;
  canvases: Canvas[];
}

interface ChannelCanvasListProps {
  canvases: Canvas[];
  folders: CanvasFolder[];
  quartoDocs?: Canvas[];
  activeFilter: FilterTab;
  onFilterChange: (filter: FilterTab) => void;
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  currentUserId?: string | undefined;
  selectedCanvasId?: string | undefined;
  onDelete?: (id: string) => void;
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
  quartoDocs = [],
  activeFilter,
  onFilterChange,
  onSelect,
  currentUserId,
  selectedCanvasId,
  onDelete,
  onCreateCanvasInFolder,
  isCreatingCanvas = false,
  showStarredOnly = false,
  onToggleStar,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [deletingCanvas, setDeletingCanvas] = useState<Canvas | null>(null);

  const canvasesWithStarState = useMemo(() => withStarredCanvasState(canvases), [canvases]);
  const quartoDocsWithStarState = useMemo(() => withStarredCanvasState(quartoDocs), [quartoDocs]);

  const displayedCanvases = useMemo(
    () =>
      filterStarredCanvases(
        getDisplayedCanvases({
          canvases: canvasesWithStarState,
          quartoDocs: quartoDocsWithStarState,
          activeFilter,
          currentUserId,
          searchQuery,
        }),
        showStarredOnly,
      ),
    [
      activeFilter,
      canvasesWithStarState,
      currentUserId,
      quartoDocsWithStarState,
      searchQuery,
      showStarredOnly,
    ],
  );

  const displayedFolders = useMemo(() => {
    if (activeFilter === 'quarto_docs' || searchQuery.trim()) return [];
    return activeFilter === 'created_by_me' && currentUserId
      ? folders.filter(folder => folder.createdBy === currentUserId)
      : folders;
  }, [activeFilter, currentUserId, folders, searchQuery]);

  const { folderGroups, rootCanvases } = useMemo(() => {
    const groups = new Map<string, FolderGroup>();

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
        .filter(group => !showStarredOnly || group.canvases.length > 0),
      rootCanvases: sortByName(root, canvas => canvas.title || 'Untitled'),
    };
  }, [activeFilter, displayedCanvases, displayedFolders, showStarredOnly]);

  const isEmpty =
    activeFilter === 'quarto_docs'
      ? displayedCanvases.length === 0
      : folderGroups.length === 0 && rootCanvases.length === 0;

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
                onClick={() => onFilterChange('quarto_docs')}
                className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  activeFilter === 'quarto_docs'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-muted-foreground hover:bg-accent'
                }`}
                data-testid='canvas-filter-quarto-docs'
                data-track-category='CANVAS'
                data-track-name='Filter_Channel_Canvases_Docs'
              >
                <BookMarked className='w-3.5 h-3.5' />
                Docs
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
          {isEmpty ? (
            <div className='flex flex-col items-center justify-center h-full text-center py-16'>
              <FileText className='w-16 h-16 text-muted-foreground mb-4' />
              <h3 className='text-lg font-medium text-foreground mb-2'>
                {searchQuery
                  ? 'No canvases found'
                  : activeFilter === 'quarto_docs'
                    ? showStarredOnly
                      ? 'No starred docs yet'
                      : 'No docs yet'
                    : 'No canvases yet'}
              </h3>
              <p className='text-muted-foreground text-sm'>
                {searchQuery
                  ? 'Try a different search'
                  : activeFilter === 'quarto_docs' && showStarredOnly
                    ? 'Star a doc to see it here.'
                    : 'Create your first canvas to get started'}
              </p>
            </div>
          ) : activeFilter === 'quarto_docs' || searchQuery.trim() ? (
            <div className='p-2 space-y-0.5'>
              {displayedCanvases.map(canvas => (
                <CanvasRow
                  key={canvas.id}
                  canvas={canvas}
                  indentClassName='pl-2'
                  onSelect={onSelect}
                  selectedCanvasId={selectedCanvasId}
                  currentUserId={currentUserId}
                  quartoDocIcon='bookmark'
                  trackNames={channelCanvasRowTrackNames}
                  onToggleStar={onToggleStar}
                  onDelete={
                    onDelete
                      ? (id): void => {
                          const targetCanvas =
                            canvases.find(item => item.id === id) ??
                            quartoDocs.find(item => item.id === id) ??
                            null;
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
                        <button
                          className='p-1 opacity-70 group-hover:opacity-100 hover:bg-muted rounded transition-all disabled:opacity-40'
                          onClick={() => onCreateCanvasInFolder(folderGroup.folder)}
                          disabled={isCreatingCanvas}
                          title='Create canvas in folder'
                          data-testid={`channel-folder-create-canvas-${folderGroup.folder.id}`}
                          data-track-category='CANVAS'
                          data-track-name='Create_Canvas_In_Channel_Folder'
                        >
                          <Plus className='w-4 h-4 text-muted-foreground' />
                        </button>
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
                          quartoDocIcon='bookmark'
                          trackNames={channelCanvasRowTrackNames}
                          onToggleStar={onToggleStar}
                          onDelete={
                            onDelete
                              ? (id): void => {
                                  const targetCanvas =
                                    canvases.find(item => item.id === id) ??
                                    quartoDocs.find(item => item.id === id) ??
                                    null;
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
                  quartoDocIcon='bookmark'
                  trackNames={channelCanvasRowTrackNames}
                  onToggleStar={onToggleStar}
                  onDelete={
                    onDelete
                      ? (id): void => {
                          const targetCanvas =
                            canvases.find(item => item.id === id) ??
                            quartoDocs.find(item => item.id === id) ??
                            null;
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
