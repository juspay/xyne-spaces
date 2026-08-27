import { useRef, useState, type ReactElement } from 'react';
import type { PartialBlock } from '@blocknote/core';
import type { CanvasVersion } from '@xyne/shared';
import { Clock3, Copy, MoreHorizontal, Pencil, RotateCcw, X } from 'lucide-react';
import { Button } from '../../ui/Button';
import { Dialog } from '../../ui/Dialog';
import Input from '../../ui/Input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../ui/dropdown-menu';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import { cn } from '../../../utils/classNames';
import { useUsers } from '../../../hooks/useUsers';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { formatCanvasVersionName } from '../../../utils/canvasVersioning';

export type CanvasVersionRecord = CanvasVersion & {
  content: PartialBlock[];
};

interface CanvasVersionHistoryProps {
  canvasId?: string | undefined;
  open: boolean;
  activeVersionId?: string | undefined;
  canRestore: boolean;
  restoringVersionId?: string | undefined;
  renamingVersionId?: string | undefined;
  copyingVersionId?: string | undefined;
  onClose: () => void;
  onPreview: (version: CanvasVersionRecord) => void;
  onRestore: (version: CanvasVersionRecord) => void;
  onRename: (version: CanvasVersionRecord, name: string) => void | Promise<void>;
  onMakeCopy: (version: CanvasVersionRecord) => void | Promise<void>;
}

export const CanvasVersionHistory = ({
  canvasId,
  open,
  activeVersionId,
  canRestore,
  restoringVersionId,
  renamingVersionId,
  copyingVersionId,
  onClose,
  onPreview,
  onRestore,
  onRename,
  onMakeCopy,
}: CanvasVersionHistoryProps): ReactElement | null => {
  const users = useUsers();
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const [renameVersion, setRenameVersion] = useState<CanvasVersionRecord | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [versions = []] = useCachedQuery(queries.canvasVersions({ canvasId: canvasId || '' }), {
    enabled: open && Boolean(canvasId),
  });

  if (!open) return null;

  const versionRows = versions as CanvasVersionRecord[];

  const getAuthorName = (createdBy?: string | null): string => {
    if (!createdBy) return 'Unknown';
    const author = users.find(user => user.id === createdBy);
    return author ? getUserDisplayName(author) : 'Unknown';
  };

  const openRenameDialog = (version: CanvasVersionRecord): void => {
    setRenameVersion(version);
    setRenameValue(version.name?.trim() || formatCanvasVersionName(version.updatedAt));
  };

  const closeRenameDialog = (): void => {
    setRenameVersion(null);
    setRenameValue('');
  };

  const submitRename = (): void => {
    if (!renameVersion) return;

    const nextName = renameValue.trim();
    if (!nextName) return;

    void Promise.resolve(onRename(renameVersion, nextName)).then(closeRenameDialog);
  };

  return (
    <>
      <aside className='absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-background shadow-xl md:relative md:z-auto md:w-80 md:shadow-none'>
        <div className='flex h-14 shrink-0 items-center justify-between border-b border-border px-4'>
          <div className='flex items-center gap-2 text-sm font-semibold text-foreground'>
            <Clock3 size={16} />
            Version history
          </div>
          <Button
            variant='ghost'
            size='iconSm'
            onClick={onClose}
            data-track-category='CANVAS'
            data-track-name='CLOSE_VERSION_HISTORY'
            aria-label='Close version history'
          >
            <X size={16} />
          </Button>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto p-3'>
          {versionRows.length === 0 ? (
            <div className='flex h-full items-center justify-center px-6 text-center text-sm text-muted-foreground'>
              No saved versions yet
            </div>
          ) : (
            <div className='space-y-1'>
              {versionRows.map(version => {
                const isActive = activeVersionId === version.id;
                const isRestoring = restoringVersionId === version.id;
                const isRenaming = renamingVersionId === version.id;
                const isCopying = copyingVersionId === version.id;
                const defaultVersionName = formatCanvasVersionName(version.updatedAt);
                const versionName = version.name?.trim() || defaultVersionName;
                const authorName = getAuthorName(version.createdBy);
                const detailText =
                  versionName === defaultVersionName
                    ? authorName
                    : `${defaultVersionName} · ${authorName}`;

                return (
                  <div
                    key={version.id}
                    className={cn(
                      'group rounded-md border border-transparent p-2 transition-colors',
                      isActive
                        ? 'border-emerald-300/70 bg-emerald-50 dark:border-emerald-500/35 dark:bg-emerald-500/10'
                        : 'hover:bg-accent',
                    )}
                  >
                    <div className='flex items-start gap-1'>
                      <button
                        type='button'
                        className='min-w-0 flex-1 text-left'
                        onClick={() => {
                          onPreview(version);
                          onClose();
                        }}
                        data-track-category='CANVAS'
                        data-track-name='Preview_Canvas_Version'
                      >
                        <div
                          className={cn(
                            'truncate text-sm font-medium text-foreground',
                            isActive && 'text-emerald-950 dark:text-emerald-50',
                          )}
                        >
                          {versionName}
                        </div>
                        <div
                          className={cn(
                            'mt-0.5 truncate text-xs text-muted-foreground',
                            isActive && 'text-emerald-900/70 dark:text-emerald-100/70',
                          )}
                        >
                          {detailText}
                        </div>
                      </button>

                      {canRestore && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              type='button'
                              className={cn(
                                'rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                                isActive &&
                                  'text-emerald-900/70 hover:bg-emerald-100 hover:text-emerald-950 dark:text-emerald-100/75 dark:hover:bg-emerald-500/15 dark:hover:text-emerald-50',
                              )}
                              aria-label='Version actions'
                            >
                              <MoreHorizontal size={16} />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align='end' className='w-40'>
                            <DropdownMenuItem
                              onClick={() => {
                                void onMakeCopy(version);
                              }}
                              data-track-category='CANVAS'
                              data-track-name='COPY_CANVAS_VERSION'
                              disabled={isRestoring || isRenaming || isCopying}
                            >
                              <Copy size={14} />
                              Make a copy
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => onRestore(version)}
                              data-track-category='CANVAS'
                              data-track-name='RESTORE_CANVAS_VERSION'
                              disabled={isRestoring || isRenaming || isCopying}
                            >
                              <RotateCcw size={14} />
                              Restore
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onClick={() => openRenameDialog(version)}
                              data-track-category='CANVAS'
                              data-track-name='OPEN_RENAME_VERSION'
                              disabled={isRestoring || isRenaming || isCopying}
                            >
                              <Pencil size={14} />
                              Rename
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

      <Dialog
        open={Boolean(renameVersion)}
        onOpenChange={open => {
          if (!open) closeRenameDialog();
        }}
        title='Rename version'
        focusRef={renameInputRef}
      >
        <form
          className='space-y-4 p-6'
          onSubmit={event => {
            event.preventDefault();
            submitRename();
          }}
        >
          <div>
            <h2 className='text-base font-semibold text-foreground'>Rename version</h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              Pick a short name that helps you recognize this saved version.
            </p>
          </div>
          <Input
            ref={renameInputRef}
            value={renameValue}
            onChange={event => setRenameValue(event.target.value)}
            maxLength={120}
            placeholder='Version name'
          />
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='secondary'
              onClick={closeRenameDialog}
              data-track-category='CANVAS'
              data-track-name='CANCEL_RENAME_VERSION'
            >
              Cancel
            </Button>
            <Button
              type='submit'
              disabled={!renameValue.trim()}
              loading={Boolean(renameVersion && renamingVersionId === renameVersion.id)}
            >
              Save
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
};
