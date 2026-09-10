import { useState, useEffect, type ReactElement } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { toast } from 'sonner';
import { SavedConfigVisibility } from '@xyne/shared';
import {
  BookmarkDefault as Bookmark,
  Globe,
  LockClose as Lock,
  DeleteDustbin01 as Trash,
  AlertTriangle,
} from '@xyne/icons';
import { cn } from '../../utils/classNames';
import { Switch } from '../ui/Switch';
import Dialog from '../ui/Dialog';
import type { DeskTicketSavedView } from '../../hooks/useDeskTicketSavedViews';

interface DeskSavedViewsControlsProps {
  savedViews: DeskTicketSavedView[];
  activeViewId: string | null;
  onActiveViewChange: (id: string | null) => void;
  currentUserId: string;
  isChannelAdmin: boolean;
  onApply: (view: DeskTicketSavedView) => void;
  onSave: (name: string, visibility: SavedConfigVisibility) => Promise<string | undefined>;
  onUpdate: (viewId: string) => Promise<void>;
  onDelete: (viewId: string) => Promise<void>;
  hasActiveFilters: boolean;
  trackCategory?: string;
}

export function DeskSavedViewsControls({
  savedViews,
  activeViewId,
  onActiveViewChange,
  currentUserId,
  isChannelAdmin,
  onApply,
  onSave,
  onUpdate,
  onDelete,
  hasActiveFilters,
  trackCategory = 'Support',
}: DeskSavedViewsControlsProps): ReactElement {
  const [showViewsPopover, setShowViewsPopover] = useState(false);
  const [showSavePopover, setShowSavePopover] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveLoading, setSaveLoading] = useState(false);
  const [viewToDelete, setViewToDelete] = useState<DeskTicketSavedView | null>(null);
  const [updateLoading, setUpdateLoading] = useState(false);

  const activeView = savedViews.find(v => v.id === activeViewId) ?? null;

  // When all filters are cleared, deactivate the active view so "Save view" reappears
  useEffect(() => {
    if (!hasActiveFilters && activeViewId) {
      onActiveViewChange(null);
    }
  }, [hasActiveFilters, activeViewId, onActiveViewChange]);

  const handleSave = async (): Promise<void> => {
    const name = saveViewName.trim();
    if (!name) return;
    setSaveLoading(true);
    setSaveError('');
    try {
      const id = await onSave(
        name,
        isPublic ? SavedConfigVisibility.PUBLIC : SavedConfigVisibility.PRIVATE,
      );
      if (id) {
        onActiveViewChange(id);
        toast.success(`View "${name}" saved`);
      }
      setSaveViewName('');
      setIsPublic(false);
      setShowSavePopover(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save view');
    } finally {
      setSaveLoading(false);
    }
  };

  const handleUpdate = async (): Promise<void> => {
    if (!activeViewId) return;
    setUpdateLoading(true);
    try {
      await onUpdate(activeViewId);
      toast.success(`View "${activeView?.name ?? ''}" updated`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to update view');
    } finally {
      setUpdateLoading(false);
    }
  };

  const handleApply = (view: DeskTicketSavedView): void => {
    onApply(view);
    onActiveViewChange(view.id);
    setShowViewsPopover(false);
  };

  const handleDeleteConfirm = async (): Promise<void> => {
    if (!viewToDelete) return;
    try {
      await onDelete(viewToDelete.id);
      if (activeViewId === viewToDelete.id) onActiveViewChange(null);
      toast.success(`View "${viewToDelete.name}" deleted`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to delete view');
    } finally {
      setViewToDelete(null);
    }
  };

  return (
    <div className='flex items-center gap-2'>
      {/* Update button — shown when an own view is active and filters exist */}
      {activeViewId && activeView && activeView.userId === currentUserId && hasActiveFilters ? (
        <button
          onClick={() => void handleUpdate()}
          disabled={updateLoading}
          className='flex items-center gap-1.5 px-2.5 h-8 text-sm rounded-lg border border-primary bg-primary/10 text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          data-track-category={trackCategory}
          data-track-name='UpdateDeskView'
        >
          {updateLoading ? 'Updating…' : `Update "${activeView.name}"`}
        </button>
      ) : (
        /* Save view — bright when filters active, disabled when not */
        <Popover.Root
          open={showSavePopover}
          onOpenChange={open => {
            setShowSavePopover(open);
            if (!open) {
              setSaveViewName('');
              setIsPublic(false);
              setSaveError('');
            }
          }}
        >
          <Popover.Trigger asChild>
            <button
              disabled={!hasActiveFilters}
              className={cn(
                'flex items-center gap-1.5 px-2.5 h-8 text-sm rounded-lg border transition-colors',
                hasActiveFilters
                  ? 'border-primary bg-primary/10 text-primary hover:bg-primary/20'
                  : 'border-border text-muted-foreground cursor-not-allowed opacity-50',
              )}
              data-track-category={trackCategory}
              data-track-name='OpenDeskSaveViewPopover'
            >
              Save view
            </button>
          </Popover.Trigger>
          <Popover.Content
            side='bottom'
            align='end'
            sideOffset={6}
            className='z-[60] w-72 bg-popover border border-border rounded-xl shadow-lg p-4 flex flex-col gap-3'
          >
            <p className='text-sm font-medium text-foreground'>Save current filters as a view</p>
            <input
              type='text'
              placeholder='Give this view a name…'
              value={saveViewName}
              onChange={e => {
                setSaveViewName(e.target.value);
                setSaveError('');
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && saveViewName.trim()) void handleSave();
              }}
              autoFocus
              data-track-category={trackCategory}
              data-track-name='DeskSaveViewNameInput'
              className='w-full text-sm border-0 border-b border-border focus:outline-none pb-1 placeholder-muted-foreground'
            />
            {saveError && <p className='text-xs text-destructive'>{saveError}</p>}
            {isChannelAdmin && (
              <div className='flex items-start gap-2'>
                <Switch
                  checked={isPublic}
                  onCheckedChange={setIsPublic}
                  label='Share with team'
                  id='desk-save-view-public-toggle'
                />
                <p className='text-xs text-muted-foreground mt-0.5'>
                  {isPublic ? 'Visible to everyone in this channel' : 'Only visible to you'}
                </p>
              </div>
            )}
            <div className='flex items-center justify-end gap-2'>
              <button
                onClick={() => setShowSavePopover(false)}
                data-track-category={trackCategory}
                data-track-name='CancelDeskSaveView'
                className='text-sm font-medium text-muted-foreground px-2 h-8 hover:text-foreground'
              >
                Cancel
              </button>
              <button
                onClick={() => void handleSave()}
                disabled={!saveViewName.trim() || saveLoading}
                data-track-category={trackCategory}
                data-track-name='ConfirmDeskSaveView'
                className='text-sm font-semibold px-4 h-8 rounded-[8px] bg-primary text-white disabled:opacity-50 disabled:cursor-not-allowed'
              >
                {saveLoading ? 'Saving…' : 'Save view'}
              </button>
            </div>
          </Popover.Content>
        </Popover.Root>
      )}

      {/* Views list popover */}
      <Popover.Root open={showViewsPopover} onOpenChange={setShowViewsPopover}>
        <Popover.Trigger asChild>
          <button
            className={cn(
              'flex items-center gap-1.5 px-2.5 h-8 text-sm rounded-lg border border-border transition-colors',
              showViewsPopover
                ? 'bg-muted text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted',
            )}
            data-track-category={trackCategory}
            data-track-name='OpenDeskViewsPopover'
          >
            <Bookmark size={14} />
            <span>Views{savedViews.length > 0 ? ` (${savedViews.length})` : ''}</span>
          </button>
        </Popover.Trigger>
        <Popover.Content
          side='bottom'
          align='end'
          sideOffset={6}
          className='z-[60] w-72 bg-popover border border-border rounded-xl shadow-lg py-2 flex flex-col'
        >
          {savedViews.length === 0 ? (
            <p className='text-sm text-muted-foreground px-3 py-2'>No saved views yet</p>
          ) : (
            <div className='flex flex-col'>
              {/* Legend */}
              <div className='flex items-center gap-3 px-3 pb-2 border-b border-border mb-1'>
                <span className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <Globe size={11} />
                  Team
                </span>
                <span className='flex items-center gap-1 text-xs text-muted-foreground'>
                  <Lock size={11} />
                  Private
                </span>
              </div>
              {savedViews.map(view => {
                const isOwn = view.userId === currentUserId;
                const isPublicView = view.visibility === (SavedConfigVisibility.PUBLIC as string);
                return (
                  <button
                    key={view.id}
                    type='button'
                    className={cn(
                      'flex items-center justify-between px-3 py-2 cursor-pointer hover:bg-muted w-full text-left',
                      activeViewId === view.id && 'bg-accent',
                    )}
                    onClick={() => handleApply(view)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') handleApply(view);
                    }}
                    data-track-category={trackCategory}
                    data-track-name='ApplyDeskSavedView'
                  >
                    <div className='flex items-center gap-2 min-w-0'>
                      {isPublicView ? (
                        <Globe size={13} className='shrink-0 text-primary' />
                      ) : (
                        <Lock size={13} className='shrink-0 text-muted-foreground' />
                      )}
                      <div className='flex flex-col min-w-0'>
                        <span className='text-sm truncate'>{view.name}</span>
                        <span className='text-xs text-muted-foreground'>
                          {isPublicView ? 'Shared with team' : 'Only you'}
                          {!isOwn && ' · by others'}
                        </span>
                      </div>
                    </div>
                    {/* Delete — always visible, only for own views */}
                    {isOwn && (
                      <button
                        onClick={e => {
                          e.stopPropagation();
                          setViewToDelete(view);
                        }}
                        className='ml-2 p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive transition-colors shrink-0'
                        title='Delete view'
                        data-track-category={trackCategory}
                        data-track-name='OpenDeleteDeskViewDialog'
                      >
                        <Trash size={13} />
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </Popover.Content>
      </Popover.Root>

      {/* Delete confirmation dialog */}
      <Dialog
        open={!!viewToDelete}
        onOpenChange={open => {
          if (!open) setViewToDelete(null);
        }}
        title='Delete saved view'
        zIndexClassName='z-[70]'
        className='max-w-sm'
      >
        {viewToDelete && (
          <div className='flex flex-col'>
            {/* Header */}
            <div className='flex items-start gap-4 px-6 pt-6 pb-5'>
              <div className='flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-full bg-destructive/10'>
                <AlertTriangle size={20} className='text-destructive' />
              </div>
              <div className='flex flex-col gap-1 min-w-0'>
                <h3 className='text-base font-semibold text-foreground'>Delete saved view</h3>
                <p className='text-sm text-muted-foreground'>
                  <span className='font-medium text-foreground'>
                    &quot;{viewToDelete.name}&quot;
                  </span>{' '}
                  will be permanently removed. This cannot be undone.
                </p>
              </div>
            </div>

            {/* Team view warning */}
            {viewToDelete.visibility === (SavedConfigVisibility.PUBLIC as string) && (
              <div className='mx-6 mb-5 flex items-start gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3'>
                <Globe size={14} className='mt-0.5 shrink-0 text-destructive' />
                <p className='text-sm text-destructive'>
                  This is a shared team view. Deleting it removes it for everyone in this channel.
                </p>
              </div>
            )}

            {/* Actions */}
            <div className='flex items-center justify-end gap-3 border-t border-border px-6 py-4'>
              <button
                onClick={() => setViewToDelete(null)}
                data-track-category={trackCategory}
                data-track-name='CancelDeleteDeskView'
                className='text-sm font-medium h-9 px-4 rounded-lg border border-border hover:bg-muted transition-colors'
              >
                Keep view
              </button>
              <button
                onClick={() => void handleDeleteConfirm()}
                data-track-category={trackCategory}
                data-track-name='ConfirmDeleteDeskView'
                className='text-sm font-semibold h-9 px-4 rounded-lg bg-destructive text-white hover:bg-destructive/90 transition-colors'
              >
                Delete view
              </button>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
