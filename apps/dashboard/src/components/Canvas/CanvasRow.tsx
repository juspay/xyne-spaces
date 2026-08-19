import React, { useEffect, useState } from 'react';
import {
  CopyDefault,
  FileText,
  Globe,
  Share01,
  Star,
  ThreeDotsMenuHorizontal,
  DeleteDustbin01,
} from '@xyne/icons';
import { Archive, ArchiveRestore } from 'lucide-react';
import { CanvasRole, CanvasVisibility } from '@xyne/shared';
import type { Canvas } from './Canvas.types';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Dialog } from '../ui/Dialog';
import { Tooltip } from '../ui/Tooltip/Tooltip';
import { CanvasShareModal } from './CanvasShareModal';
import { cn } from '../../utils/classNames';
import { getCanvasLabelDotClassName, getCanvasLabels } from './canvasLabelUtils';
import { canvasLabelsApi } from '../../api/canvasLabelsApi';

interface CanvasRowTrackNames {
  canvasOpen: string;
  actionsMenu: string;
}

export const HighlightedText: React.FC<{ text: string; query?: string | undefined }> = ({
  text,
  query,
}) => {
  const normalizedQuery = query?.trim().toLowerCase();
  if (!normalizedQuery) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  const lowerText = text.toLowerCase();
  let cursor = 0;
  let matchIndex = lowerText.indexOf(normalizedQuery);

  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }

    const matchEnd = matchIndex + normalizedQuery.length;
    parts.push(
      <mark
        key={`${matchIndex}-${matchEnd}`}
        className='rounded bg-[var(--search-result-highlight-bg)] px-0.5 text-foreground'
      >
        {text.slice(matchIndex, matchEnd)}
      </mark>,
    );

    cursor = matchEnd;
    matchIndex = lowerText.indexOf(normalizedQuery, cursor);
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <>{parts}</>;
};

export interface CanvasRowProps {
  canvas: Canvas;
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  selectedCanvasId?: string | undefined;
  currentUserId?: string | undefined;
  indentClassName?: string | undefined;
  onDelete?: ((id: string) => void) | undefined;
  onDuplicate?: ((canvas: Canvas) => void) | undefined;
  onToggleStar?: ((canvas: Canvas) => void) | undefined;
  onArchiveToggle?: ((canvas: Canvas) => void) | undefined;
  trackNames: CanvasRowTrackNames;
  highlightQuery?: string | undefined;
}

export const CanvasRow: React.FC<CanvasRowProps> = ({
  canvas,
  onSelect,
  selectedCanvasId,
  currentUserId,
  indentClassName = 'pl-2',
  onDelete,
  onDuplicate,
  onToggleStar,
  onArchiveToggle,
  trackNames,
  highlightQuery,
}) => {
  const [shareOpen, setShareOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [restLabels, setRestLabels] = useState<Canvas['labels'] | undefined>(undefined);
  const isSelected = selectedCanvasId === canvas.id;
  const isOwner = canvas.createdBy === currentUserId;
  const isEditor = canvas.accessLevel === CanvasRole.EDITOR;
  const canToggleStar = !!onToggleStar;
  const canvasWithRestLabels =
    restLabels !== undefined ? { ...canvas, labels: restLabels } : canvas;
  const canvasLabels = getCanvasLabels(canvasWithRestLabels);
  const visibleLabels = canvasLabels.slice(0, 2);
  const hiddenLabelCount = Math.max(0, canvasLabels.length - visibleLabels.length);

  useEffect(() => {
    if (Array.isArray(canvas.labels) || !canvas.id || canvas.id === 'new') {
      setRestLabels(undefined);
      return;
    }

    let cancelled = false;
    canvasLabelsApi
      .getCanvasLabels([canvas.id])
      .then(labelsByCanvasId => {
        if (!cancelled) {
          setRestLabels(labelsByCanvasId[canvas.id] ?? []);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRestLabels(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [canvas.id, canvas.labels]);

  // The frame uses `file/file-text` for canvas rows. Public canvases keep the
  // globe so the (exceptional) shared state stays legible at a glance.
  const RowIcon = canvas.visibility === CanvasVisibility.PUBLIC ? Globe : FileText;

  return (
    <>
      {/* Indent lives on a wrapper so the row keeps its own `px-3` from the
          frame spec — a `pl-*` indent on the row itself would fight it. */}
      <div className={indentClassName}>
        <div
          className={cn(
            'group flex items-center gap-3 h-9 px-3 rounded-[10px] border border-transparent transition-colors',
            isSelected
              ? 'bg-sidebar-accent border-sidebar-border text-sidebar-accent-foreground'
              : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
          )}
        >
          <button
            className='flex min-w-0 flex-1 items-center gap-3 text-left'
            onClick={event => onSelect(event, canvas)}
            data-track-category='CANVAS'
            data-track-name={trackNames.canvasOpen}
          >
            <span className='size-4 flex items-center justify-center shrink-0'>
              <RowIcon size={16} />
            </span>
            <Tooltip
              content={canvas.title || 'Untitled'}
              side='top'
              align='start'
              className='max-w-xs break-words'
            >
              <span className='min-w-0 flex-1 truncate block text-sm font-medium tracking-[-0.14px]'>
                <HighlightedText text={canvas.title || 'Untitled'} query={highlightQuery} />
              </span>
            </Tooltip>
            {canvas.isArchived && (
              <span className='inline-flex h-4 shrink-0 items-center rounded border border-amber-200 bg-amber-50 px-1 text-[10px] font-medium leading-none text-amber-700'>
                Archived
              </span>
            )}
            {visibleLabels.length > 0 && (
              <span className='hidden min-w-0 shrink-0 items-center gap-1 lg:flex'>
                {visibleLabels.map(label => (
                  <span
                    key={label.id}
                    className='inline-flex h-5 max-w-[96px] items-center gap-1 rounded-md border border-sidebar-border-muted bg-sidebar px-1.5 text-[11px] leading-none text-sidebar-foreground/70'
                  >
                    <span
                      className={`size-1.5 shrink-0 rounded-full ${getCanvasLabelDotClassName(
                        label.name,
                      )}`}
                    />
                    <span className='truncate'>{label.name}</span>
                  </span>
                ))}
                {hiddenLabelCount > 0 && (
                  <span className='text-[11px] text-sidebar-foreground/50'>
                    +{hiddenLabelCount}
                  </span>
                )}
              </span>
            )}
          </button>

          {canToggleStar && (
            <button
              className={cn(
                'items-center justify-center p-1 rounded-md shrink-0 hover:bg-sidebar-accent',
                // Display (not opacity) so a hidden control reserves no width and
                // the title truncates only when it genuinely runs out of room.
                canvas.isStarred ? 'flex' : 'hidden group-hover:flex',
              )}
              onClick={event => {
                event.stopPropagation();
                onToggleStar?.(canvas);
              }}
              title={canvas.isStarred ? 'Unstar canvas' : 'Star canvas'}
              data-track-category='CANVAS'
              data-track-name='TOGGLE_CANVAS_STAR'
            >
              <Star
                size={14}
                variant={canvas.isStarred ? 'Solid' : 'Stroke'}
                {...(canvas.isStarred ? { className: 'text-status-pending' } : {})}
              />
            </button>
          )}

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
            <DropdownMenuTrigger asChild>
              <button
                className={cn(
                  'items-center justify-center p-1 rounded-md shrink-0 hover:bg-sidebar-accent',
                  menuOpen ? 'flex' : 'hidden group-hover:flex',
                )}
                onClick={event => event.stopPropagation()}
                data-track-category='CANVAS'
                data-track-name={trackNames.actionsMenu}
              >
                <ThreeDotsMenuHorizontal size={14} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='w-44'>
              {onDuplicate && (
                <DropdownMenuItem className='gap-2' onClick={() => onDuplicate(canvas)}>
                  <CopyDefault size={14} className='shrink-0' />
                  <span className='flex-1'>Duplicate</span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem className='gap-2' onClick={() => setShareOpen(true)}>
                <Share01 size={14} className='shrink-0' />
                <span className='flex-1'>Share</span>
              </DropdownMenuItem>
              {(onArchiveToggle || onDelete) && isOwner && (
                <>
                  <DropdownMenuSeparator />
                  {onArchiveToggle && (
                    <DropdownMenuItem
                      className='gap-2'
                      onClick={() => onArchiveToggle(canvas)}
                      data-track-category='CANVAS'
                      data-track-name={canvas.isArchived ? 'UNARCHIVE_CANVAS' : 'ARCHIVE_CANVAS'}
                    >
                      {canvas.isArchived ? (
                        <ArchiveRestore size={14} className='shrink-0' />
                      ) : (
                        <Archive size={14} className='shrink-0' />
                      )}
                      <span className='flex-1'>{canvas.isArchived ? 'Unarchive' : 'Archive'}</span>
                    </DropdownMenuItem>
                  )}
                  {onDelete && (
                    <DropdownMenuItem
                      onClick={() => onDelete(canvas.id)}
                      className='gap-2 text-destructive focus:text-destructive'
                    >
                      <DeleteDustbin01 size={14} className='shrink-0' />
                      <span className='flex-1'>Delete</span>
                    </DropdownMenuItem>
                  )}
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {shareOpen && (
        <Dialog
          open={shareOpen}
          onOpenChange={open => !open && setShareOpen(false)}
          title='Share Canvas'
        >
          <CanvasShareModal
            key={canvas.id}
            onClose={() => setShareOpen(false)}
            canvas={canvas}
            isOwner={isOwner}
            isEditor={isEditor}
            {...(canvas.channelId ? { channelId: canvas.channelId } : {})}
          />
        </Dialog>
      )}
    </>
  );
};
