import React, { useState, useMemo, useEffect } from 'react';
import {
  FileText,
  Trash2,
  Copy,
  Search,
  MoreVertical,
  Share2,
  Globe,
  Lock,
  BookMarked,
  ExternalLink,
} from 'lucide-react';
import { CanvasListProps, Canvas } from '../Canvas.types';
import { CanvasRole, CanvasVisibility, DocType } from '@xyne/shared';
import Avatar from '../../ui/Avatar/Avatar';
import AvatarGroup from '../../ui/Avatar/AvatarGroup';
import Input from '../../ui/Input';
import { Dialog } from '../../ui/Dialog';
import { UserHoverWrapper } from '../../ui/UserMentionPopover/UserMentionPopover';
import { useUser } from '../../../hooks/useUsers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { CanvasDeleteModal } from '../CanvasDeleteModal';
import { CanvasShareModal } from '../CanvasShareModal';
import { queries } from '../../../zero/queries';
import { CanvasParticipantsTray, type ParticipantItem } from '../CanvasParticipantsTray';
import { useNavigate } from 'react-router-dom';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useCanvasPrefetch } from '../../../hooks/useCanvasPrefetch';

type FilterTab = 'all' | 'created_by_me' | 'quarto_docs';

const CreatorName: React.FC<{ userId: string; isCurrentUser: boolean }> = ({
  userId,
  isCurrentUser,
}) => {
  const user = useUser(userId);
  const displayName = user?.name || user?.email || 'Unknown';
  if (isCurrentUser) {
    return <span>{displayName} (You)</span>;
  }
  return <span>{displayName}</span>;
};

const ParticipantsTray: React.FC<{
  isOpen: boolean;
  onClose: () => void;
  canvasId: string;
}> = ({ isOpen, onClose, canvasId }) => {
  const [participants] = useCachedQuery(queries.canvasParticipants({ canvasId }));

  const formattedParticipants: ParticipantItem[] = useMemo(() => {
    if (!participants) return [];

    return participants.map(p => ({
      id: p.id,
      userId: p.userId,
      role: p.role,
    }));
  }, [participants]);

  return (
    <Dialog open={isOpen} onOpenChange={open => !open && onClose()} title='Participants'>
      <CanvasParticipantsTray
        onClose={onClose}
        participants={formattedParticipants}
        showRole={true}
        showColor={false}
      />
    </Dialog>
  );
};

export const CanvasList: React.FC<CanvasListProps> = ({
  canvases,
  onSelect,
  onDelete,
  onDuplicate,
  loading = false,
  currentUserId,
  quartoDocs = [],
  showQuartoDocsFilter = false,
  activeFilter: externalActiveFilter,
  onFilterChange,
}) => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingCanvasId, setDeletingCanvasId] = useState<string | null>(null);
  const [internalActiveFilter, setInternalActiveFilter] = useState<FilterTab>('all');
  const [shareCanvas, setShareCanvas] = useState<Canvas | null>(null);
  const [participantsTrayCanvas, setParticipantsTrayCanvas] = useState<Canvas | null>(null);

  const { prefetchTopCanvases, handleMouseEnter, handleMouseLeave } = useCanvasPrefetch();

  // Use external filter if provided, otherwise use internal state
  const activeFilter = externalActiveFilter ?? internalActiveFilter;

  const setActiveFilter = (filter: FilterTab): void => {
    if (onFilterChange) {
      onFilterChange(filter);
    } else {
      setInternalActiveFilter(filter);
    }
  };

  useEffect(() => {
    if (canvases.length > 0 && activeFilter !== 'quarto_docs') {
      const collaborativeCanvases = canvases.filter(c => c.isCollaborative !== false);
      void prefetchTopCanvases(
        collaborativeCanvases.map(c => ({
          id: c.id,
          ...(c.channelId ? { channelId: c.channelId } : {}),
          ...(c.viewAccessId ? { viewAccessId: c.viewAccessId } : {}),
          ...(c.isCollaborative !== undefined ? { isCollaborative: c.isCollaborative } : {}),
          title: c.title,
        })),
        3,
      );
    }
  }, [canvases, activeFilter, prefetchTopCanvases]);

  const filteredCanvases = useMemo(() => {
    // If showing Quarto docs filter, return Quarto docs when that filter is active
    if (activeFilter === 'quarto_docs') {
      let filtered = quartoDocs;
      if (searchQuery) {
        filtered = filtered.filter(
          canvas =>
            canvas.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
            (canvas.userRepo?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false),
        );
      }
      return filtered;
    }

    let filtered = canvases;

    if (activeFilter === 'created_by_me' && currentUserId) {
      filtered = filtered.filter(canvas => canvas.createdBy === currentUserId);
    }

    if (searchQuery) {
      filtered = filtered.filter(canvas =>
        canvas.title.toLowerCase().includes(searchQuery.toLowerCase()),
      );
    }

    return filtered;
  }, [canvases, quartoDocs, activeFilter, currentUserId, searchQuery]);

  const handleQuartoDocClick = (canvas: Canvas): void => {
    if (canvas.userRepo) {
      void navigate(`/docs/${canvas.userRepo}`);
    }
  };

  const getUserRole = (canvas: Canvas): CanvasRole | null => {
    if (canvas.createdBy === currentUserId) {
      return CanvasRole.OWNER;
    }
    if (canvas.accessLevel) {
      return canvas.accessLevel;
    }
    const canvasWithParticipants = canvas as Canvas & {
      participants?: { userId: string; role: CanvasRole }[];
    };
    const participant = canvasWithParticipants.participants?.find(p => p.userId === currentUserId);
    return participant?.role || null;
  };

  const canPerformAction = (canvas: Canvas, action: 'delete' | 'share' | 'manage'): boolean => {
    if (action === 'delete') {
      return canvas.createdBy === currentUserId;
    }

    if (action === 'share') {
      return true;
    }

    const role = getUserRole(canvas);
    if (!role) return false;

    switch (action) {
      case 'manage':
        return role === CanvasRole.OWNER;
      default:
        return false;
    }
  };

  if (loading) {
    return (
      <div className='flex items-center justify-center h-64'>
        <div className='animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600'></div>
      </div>
    );
  }

  return (
    <div className='flex flex-col h-full bg-white' data-testid='canvas-list'>
      <div className='px-4 md:px-6 py-4 border-b border-gray-100'>
        <div className='flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 sm:gap-0'>
          <div className='flex items-center gap-2'>
            <button
              onClick={() => setActiveFilter('all')}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
                activeFilter === 'all'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
              data-testid='canvas-filter-all'
              data-track-category='CANVAS'
              data-track-name='FILTER_ALL'
              data-track-metadata={JSON.stringify({ filter: 'all', canvasCount: canvases.length })}
            >
              All
            </button>
            <button
              onClick={() => setActiveFilter('created_by_me')}
              className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all ${
                activeFilter === 'created_by_me'
                  ? 'bg-gray-100 text-gray-900'
                  : 'text-gray-600 hover:bg-gray-50'
              }`}
              data-testid='canvas-filter-created-by-me'
              data-track-category='CANVAS'
              data-track-name='FILTER_CREATED_BY_ME'
              data-track-metadata={JSON.stringify({ filter: 'created_by_me' })}
            >
              Created by me
            </button>
            {showQuartoDocsFilter && (
              <button
                onClick={() => setActiveFilter('quarto_docs')}
                className={`px-3 md:px-4 py-1.5 md:py-2 text-sm font-medium rounded-full transition-all flex items-center gap-1.5 ${
                  activeFilter === 'quarto_docs'
                    ? 'bg-blue-100 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50'
                }`}
                data-testid='canvas-filter-quarto-docs'
                data-track-category='CANVAS'
                data-track-name='FILTER_QUARTO_DOCS'
                data-track-metadata={JSON.stringify({
                  filter: 'quarto_docs',
                  quartoCount: quartoDocs.length,
                })}
              >
                <BookMarked className='w-3.5 h-3.5' />
                Docs
              </button>
            )}
          </div>

          <div className='relative w-full sm:w-auto'>
            <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400' />
            <Input
              type='text'
              value={searchQuery}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearchQuery(e.target.value)}
              placeholder='Search Document'
              className='pl-9 w-full sm:w-48 md:w-64'
            />
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-auto'>
        {filteredCanvases.length === 0 ? (
          <div className='flex flex-col items-center justify-center h-full text-center py-16'>
            <FileText className='w-16 h-16 text-gray-200 mb-4' />
            <h3 className='text-lg font-medium text-gray-700 mb-2'>
              {searchQuery ? 'No canvases found' : 'No canvases yet'}
            </h3>
            <p className='text-gray-500 text-sm'>
              {searchQuery
                ? 'Try adjusting your search'
                : 'Create your first canvas to get started'}
            </p>
          </div>
        ) : (
          <div className='divide-y divide-gray-50'>
            {filteredCanvases.map(canvas => {
              const canvasWithParticipants = canvas as Canvas & {
                participants?: { userId: string; role: CanvasRole }[];
              };

              const participantUserIds = [
                canvas.createdBy,
                ...(canvasWithParticipants.participants
                  ?.map(p => p.userId)
                  .filter(id => id !== canvas.createdBy) || []),
              ];

              const isQuartoDoc = canvas.docType === DocType.Quarto;

              return (
                <div
                  key={canvas.id}
                  role='button'
                  tabIndex={0}
                  className='group flex items-center px-6 py-4 hover:bg-gray-50 transition-colors cursor-pointer'
                  onClick={() => (isQuartoDoc ? handleQuartoDocClick(canvas) : onSelect(canvas))}
                  data-track-category='CANVAS'
                  data-track-name={isQuartoDoc ? 'Open_Quarto_Doc' : 'Open_Canvas'}
                  data-track-metadata={JSON.stringify({
                    canvasId: canvas.id,
                    title: canvas.title,
                    isQuartoDoc,
                  })}
                  data-testid={`canvas-item-${canvas.id}`}
                  onMouseEnter={() => {
                    if (!isQuartoDoc && canvas.isCollaborative !== false) {
                      handleMouseEnter({
                        id: canvas.id,
                        ...(canvas.channelId ? { channelId: canvas.channelId } : {}),
                        ...(canvas.viewAccessId ? { viewAccessId: canvas.viewAccessId } : {}),
                        ...(canvas.isCollaborative !== undefined
                          ? { isCollaborative: canvas.isCollaborative }
                          : {}),
                        title: canvas.title,
                      });
                    }
                  }}
                  onMouseLeave={handleMouseLeave}
                  onKeyDown={(e: React.KeyboardEvent) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      if (isQuartoDoc) {
                        handleQuartoDocClick(canvas);
                      } else {
                        onSelect(canvas);
                      }
                    }
                  }}
                >
                  <div className='flex-shrink-0 mr-4'>
                    <div
                      className={`w-8 h-8 flex items-center justify-center rounded ${
                        isQuartoDoc ? 'bg-blue-50' : 'bg-gray-50'
                      }`}
                    >
                      {isQuartoDoc ? (
                        <BookMarked className='w-4 h-4 text-blue-500' strokeWidth={2.5} />
                      ) : (
                        <FileText className='w-4 h-4 text-gray-500' strokeWidth={2.5} />
                      )}
                    </div>
                  </div>

                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2 mb-1'>
                      <h3 className='font-medium text-gray-900 truncate' title={canvas.title}>
                        {canvas.title}
                      </h3>
                      {isQuartoDoc &&
                        canvas.quartoDocumentType &&
                        canvas.quartoDocumentType !== 'docs' && (
                          <span className='px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600'>
                            {canvas.quartoDocumentType}
                          </span>
                        )}
                    </div>

                    <div className='flex flex-wrap items-center gap-3 text-sm text-gray-500'>
                      <UserHoverWrapper userId={canvas.createdBy}>
                        <span className='flex items-center gap-1.5 cursor-pointer'>
                          <Avatar userId={canvas.createdBy} size='sm' />
                          <span className='hidden md:inline'>
                            <CreatorName
                              userId={canvas.createdBy}
                              isCurrentUser={canvas.createdBy === currentUserId}
                            />
                          </span>
                        </span>
                      </UserHoverWrapper>

                      <span className='text-gray-300'>|</span>

                      {isQuartoDoc && canvas.userRepo ? (
                        <span
                          className='flex items-center gap-1 text-xs truncate max-w-[200px]'
                          title={canvas.userRepo}
                        >
                          <ExternalLink className='w-3 h-3' />
                          {canvas.userRepo}
                        </span>
                      ) : (
                        <span className='flex items-center gap-1'>
                          {canvas.visibility === CanvasVisibility.PUBLIC ? (
                            <>
                              <Globe className='w-3.5 h-3.5 text-green-500' strokeWidth={2.5} />
                              <span className='text-green-600'>Public</span>
                            </>
                          ) : (
                            <>
                              <Lock className='w-3.5 h-3.5 text-gray-400' strokeWidth={2.5} />
                              <span>Private</span>
                            </>
                          )}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className='flex items-center gap-3 ml-4'>
                    {!isQuartoDoc && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setParticipantsTrayCanvas(canvas);
                        }}
                        className='cursor-pointer'
                        data-track-category='CANVAS'
                        data-track-name='Open_Participants_Tray'
                        data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                      >
                        {/* Mobile: show 2 participants */}
                        <div className='md:hidden'>
                          <AvatarGroup userIds={participantUserIds} size='sm' count={2} />
                        </div>
                        {/* Desktop: show 3 participants */}
                        <div className='hidden md:block'>
                          <AvatarGroup userIds={participantUserIds} size='sm' count={3} />
                        </div>
                      </button>
                    )}

                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button
                          onClick={e => e.stopPropagation()}
                          className='p-1.5 rounded hover:bg-gray-100'
                          data-track-category='CANVAS'
                          data-track-name='Open_Canvas_Menu'
                          data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                        >
                          <MoreVertical className='w-4 h-4 text-gray-500' strokeWidth={2.5} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align='end' className='w-48'>
                        {!isQuartoDoc && onDuplicate && (
                          <DropdownMenuItem
                            onClick={e => {
                              e.stopPropagation();
                              onDuplicate(canvas.id);
                            }}
                            className='flex items-center gap-2 cursor-pointer'
                            data-track-category='CANVAS'
                            data-track-name='Duplicate_Canvas'
                            data-track-metadata={JSON.stringify({
                              canvasId: canvas.id,
                              title: canvas.title,
                            })}
                          >
                            <Copy className='w-4 h-4' />
                            Duplicate
                          </DropdownMenuItem>
                        )}

                        {canPerformAction(canvas, 'share') && (
                          <DropdownMenuItem
                            onClick={e => {
                              e.stopPropagation();
                              if (isQuartoDoc && canvas.userRepo) {
                                // For Quarto docs, copy the docs link directly
                                const docsLink = `${window.location.origin}/docs/${canvas.userRepo}`;
                                void navigator.clipboard.writeText(docsLink);
                              } else {
                                setShareCanvas(canvas);
                              }
                            }}
                            className='flex items-center gap-2 cursor-pointer'
                            data-track-category='CANVAS'
                            data-track-name={isQuartoDoc ? 'Copy_Quarto_Doc_Link' : 'Share_Canvas'}
                            data-track-metadata={JSON.stringify({
                              canvasId: canvas.id,
                              title: canvas.title,
                              isQuartoDoc,
                            })}
                          >
                            <Share2 className='w-4 h-4' />
                            {isQuartoDoc ? 'Copy Link' : 'Share'}
                          </DropdownMenuItem>
                        )}

                        {onDelete && canPerformAction(canvas, 'delete') && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onClick={e => {
                                e.stopPropagation();
                                setDeletingCanvasId(canvas.id);
                              }}
                              className='flex items-center gap-2 cursor-pointer text-red-600 focus:text-red-600 focus:bg-red-50'
                              data-testid='canvas-delete-button'
                              data-track-category='CANVAS'
                              data-track-name='DELETE_CANVAS'
                              data-track-metadata={JSON.stringify({ canvasId: canvas.id })}
                            >
                              <Trash2 className='w-4 h-4' />
                              Delete
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <Dialog
        open={!!deletingCanvasId}
        onOpenChange={open => !open && setDeletingCanvasId(null)}
        title='Delete Canvas'
      >
        <CanvasDeleteModal
          onClose={() => setDeletingCanvasId(null)}
          onConfirm={() => {
            if (deletingCanvasId && onDelete) {
              onDelete(deletingCanvasId);
              setDeletingCanvasId(null);
            }
          }}
          canvasTitle={canvases.find(c => c.id === deletingCanvasId)?.title}
        />
      </Dialog>

      {shareCanvas && (
        <Dialog
          open={!!shareCanvas}
          onOpenChange={open => !open && setShareCanvas(null)}
          title='Share Canvas'
        >
          <CanvasShareModal
            key={shareCanvas.id}
            canvas={shareCanvas}
            isOwner={shareCanvas.createdBy === currentUserId}
            isEditor={shareCanvas.accessLevel === CanvasRole.EDITOR}
            {...(shareCanvas.channelId && { channelId: shareCanvas.channelId })}
          />
        </Dialog>
      )}

      {participantsTrayCanvas && (
        <ParticipantsTray
          isOpen={!!participantsTrayCanvas}
          onClose={() => setParticipantsTrayCanvas(null)}
          canvasId={participantsTrayCanvas.id}
        />
      )}
    </div>
  );
};
