import React, { useState, useCallback } from 'react';
import { Bookmark, List, Users } from 'lucide-react';
import { SavedConfigVisibility } from '@xyne/shared';
import { cn } from '../../utils/classNames';
import { Popover } from '../ui/Popover/Popover';
import { useConfirmDialog } from '../../hooks/useConfirmDialog';
import { toast } from 'sonner';

export interface DeskSavedViewBase {
  id: string;
  name: string;
  userId: string;
  visibility: SavedConfigVisibility;
}

interface DeskSavedViewsControlsProps {
  savedViews: DeskSavedViewBase[];
  activeViewId: string | null;
  onActiveViewChange: (viewId: string | null) => void;
  currentUserId: string | undefined;
  isChannelAdmin: boolean;
  onApply: (viewId: string) => void;
  onSave: (name: string, visibility: SavedConfigVisibility) => Promise<string>;
  onDelete: (viewId: string) => Promise<void>;
  trackCategory: string;
  align?: 'start' | 'center' | 'end';
}

export const DeskSavedViewsControls = ({
  savedViews,
  activeViewId,
  onActiveViewChange,
  currentUserId,
  isChannelAdmin,
  onApply,
  onSave,
  onDelete,
  trackCategory,
  align = 'end',
}: DeskSavedViewsControlsProps): React.ReactElement => {
  const [savedViewsPopoverOpen, setSavedViewsPopoverOpen] = useState(false);
  const [saveViewPopoverOpen, setSaveViewPopoverOpen] = useState(false);
  const [saveViewName, setSaveViewName] = useState('');
  const [saveViewLoading, setSaveViewLoading] = useState(false);
  const [saveViewError, setSaveViewError] = useState<string | null>(null);
  const [saveViewIsPublic, setSaveViewIsPublic] = useState(false);

  const { confirm, ConfirmDialog } = useConfirmDialog();

  const handleSaveView = useCallback(async () => {
    if (!saveViewName.trim()) return;
    setSaveViewLoading(true);
    setSaveViewError(null);
    try {
      const id = await onSave(
        saveViewName.trim(),
        saveViewIsPublic ? SavedConfigVisibility.PUBLIC : SavedConfigVisibility.PRIVATE,
      );
      onActiveViewChange(id);
      setSaveViewPopoverOpen(false);
      setSaveViewName('');
      setSaveViewIsPublic(false);
      toast.success('View saved');
    } catch (err) {
      setSaveViewError(err instanceof Error ? err.message : 'Failed to save view');
    } finally {
      setSaveViewLoading(false);
    }
  }, [saveViewName, saveViewIsPublic, onSave, onActiveViewChange]);

  const handleDeleteView = useCallback(
    async (view: DeskSavedViewBase) => {
      const confirmed = await confirm({
        title: 'Delete view',
        description: `Are you sure you want to delete "${view.name}"? This cannot be undone.`,
        confirmLabel: 'Delete',
        cancelLabel: 'Cancel',
        variant: 'destructive',
      });
      if (!confirmed) return;
      try {
        await onDelete(view.id);
        if (activeViewId === view.id) onActiveViewChange(null);
      } catch {
        toast.error('Failed to delete view');
      }
    },
    [confirm, onDelete, activeViewId, onActiveViewChange],
  );

  const triggerButtonClass = cn(
    'flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-xs font-medium transition-colors',
    'text-muted-foreground hover:bg-accent hover:text-foreground',
  );

  return (
    <>
      {/* Views list */}
      <Popover
        open={savedViewsPopoverOpen}
        onOpenChange={setSavedViewsPopoverOpen}
        align={align}
        sideOffset={6}
        className='p-0'
        trigger={
          <button
            type='button'
            className={cn(triggerButtonClass, savedViewsPopoverOpen && 'bg-accent text-foreground')}
            aria-label='Saved views'
            data-track-category={trackCategory}
            data-track-name='OpenSavedViews'
          >
            <List size={14} />
            <span>Views{savedViews.length > 0 ? ` (${savedViews.length})` : ''}</span>
          </button>
        }
      >
        <div className='w-64'>
          <div className='border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
            Saved views
          </div>
          {savedViews.length === 0 ? (
            <div className='p-4 text-center text-sm text-muted-foreground'>No saved views yet</div>
          ) : (
            <div className='max-h-64 overflow-y-auto p-1'>
              {savedViews.map(view => (
                <div
                  key={view.id}
                  className={cn(
                    'flex items-center justify-between rounded-[6px] px-3 py-1.5 text-sm transition-colors',
                    activeViewId === view.id
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-muted',
                  )}
                >
                  <button
                    type='button'
                    className='flex flex-1 items-center gap-2 truncate text-left'
                    onClick={() => {
                      onApply(view.id);
                      onActiveViewChange(view.id);
                      setSavedViewsPopoverOpen(false);
                    }}
                    data-track-category={trackCategory}
                    data-track-name='ApplySavedView'
                  >
                    {view.visibility === SavedConfigVisibility.PUBLIC ? (
                      <Users size={13} className='shrink-0 text-muted-foreground' />
                    ) : (
                      <Bookmark size={13} className='shrink-0 text-muted-foreground' />
                    )}
                    <span className='truncate'>{view.name}</span>
                  </button>
                  {view.userId === currentUserId && (
                    <button
                      type='button'
                      onClick={() => void handleDeleteView(view)}
                      className='ml-2 shrink-0 text-xs text-muted-foreground hover:text-destructive transition-colors'
                      aria-label={`Delete ${view.name}`}
                      data-track-category={trackCategory}
                      data-track-name='DeleteSavedView'
                    >
                      Delete
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </Popover>

      {/* Save view */}
      <Popover
        open={saveViewPopoverOpen}
        onOpenChange={open => {
          setSaveViewPopoverOpen(open);
          if (!open) {
            setSaveViewName('');
            setSaveViewError(null);
            setSaveViewIsPublic(false);
          }
        }}
        align={align}
        sideOffset={6}
        className='p-0'
        trigger={
          <button
            type='button'
            className={cn(triggerButtonClass, saveViewPopoverOpen && 'bg-accent text-foreground')}
            aria-label='Save current filters as a view'
            data-track-category={trackCategory}
            data-track-name='OpenSaveView'
          >
            <Bookmark size={14} />
            <span>Save view</span>
          </button>
        }
      >
        <div className='w-72 p-3'>
          <p className='mb-2 text-sm font-medium text-foreground'>Save current filters</p>
          <input
            type='text'
            placeholder='View name…'
            value={saveViewName}
            onChange={e => setSaveViewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && saveViewName.trim() && !saveViewLoading)
                void handleSaveView();
            }}
            className='mb-2 w-full rounded-[6px] border border-border bg-background px-2.5 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary'
            data-track-category={trackCategory}
            data-track-name='SaveViewNameInput'
            autoFocus
          />
          {isChannelAdmin && (
            <label className='mb-3 flex cursor-pointer items-center gap-2 text-sm text-foreground'>
              <input
                type='checkbox'
                checked={saveViewIsPublic}
                onChange={e => setSaveViewIsPublic(e.target.checked)}
                className='rounded'
                data-track-category={trackCategory}
                data-track-name='ToggleShareWithTeam'
              />
              Share with team
            </label>
          )}
          {saveViewError && <p className='mb-2 text-xs text-destructive'>{saveViewError}</p>}
          <button
            type='button'
            disabled={!saveViewName.trim() || saveViewLoading}
            onClick={() => void handleSaveView()}
            className='w-full rounded-[6px] bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50'
            data-track-category={trackCategory}
            data-track-name='SaveView'
          >
            {saveViewLoading ? 'Saving…' : 'Save'}
          </button>
        </div>
      </Popover>

      <ConfirmDialog />
    </>
  );
};
