import React, { useState } from 'react';
import { Copy, FileText, Globe, Lock, MoreHorizontal, Share2, Star, Trash2 } from 'lucide-react';
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
import { CanvasShareModal } from './CanvasShareModal';
import { formatDate } from '../../utils/dateUtils';

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
        className='rounded bg-yellow-100 px-0.5 text-foreground'
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
  trackNames,
  highlightQuery,
}) => {
  const [shareOpen, setShareOpen] = useState(false);
  const isSelected = selectedCanvasId === canvas.id;
  const isOwner = canvas.createdBy === currentUserId;
  const isEditor = canvas.accessLevel === CanvasRole.EDITOR;
  const canToggleStar = !!onToggleStar;
  const createdDateText = `Created ${formatDate(canvas.createdAt)}`;

  return (
    <>
      <div className={`flex items-center group ${indentClassName} pr-2`}>
        <button
          className={`flex min-w-0 flex-1 items-center gap-2 px-3 py-2 text-left hover:bg-accent rounded-md transition-colors ${
            isSelected ? 'bg-accent' : ''
          }`}
          onClick={event => onSelect(event, canvas)}
          data-track-category='CANVAS'
          data-track-name={trackNames.canvasOpen}
        >
          <FileText className='w-4 h-4 text-muted-foreground shrink-0' />
          <div className='min-w-0 flex-1'>
            <div className='text-sm truncate'>
              <HighlightedText text={canvas.title || 'Untitled'} query={highlightQuery} />
            </div>
            <div className='text-xs text-muted-foreground truncate'>{createdDateText}</div>
          </div>
          <span
            className='ml-3 flex items-center text-xs text-muted-foreground shrink-0'
            aria-label={
              canvas.visibility === CanvasVisibility.PUBLIC ? 'Public canvas' : 'Private canvas'
            }
            title={canvas.visibility === CanvasVisibility.PUBLIC ? 'Public' : 'Private'}
          >
            {canvas.visibility === CanvasVisibility.PUBLIC ? (
              <Globe className='w-3 h-3 text-green-500' />
            ) : (
              <Lock className='w-3 h-3' />
            )}
          </span>
        </button>

        {canToggleStar && (
          <button
            className='p-1 hover:bg-accent rounded transition-colors'
            onClick={event => {
              event.stopPropagation();
              onToggleStar?.(canvas);
            }}
            title={canvas.isStarred ? 'Unstar canvas' : 'Star canvas'}
            data-track-category='CANVAS'
            data-track-name='TOGGLE_CANVAS_STAR'
          >
            <Star
              className={`w-4 h-4 ${
                canvas.isStarred ? 'fill-yellow-400 text-yellow-500' : 'text-muted-foreground'
              }`}
            />
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className='p-1 opacity-0 group-hover:opacity-100 hover:bg-accent rounded transition-all'
              onClick={event => event.stopPropagation()}
              data-track-category='CANVAS'
              data-track-name={trackNames.actionsMenu}
            >
              <MoreHorizontal className='w-4 h-4 text-muted-foreground' />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align='end' className='w-44'>
            {onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate(canvas)}>
                <Copy className='w-4 h-4 mr-2' />
                Duplicate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => setShareOpen(true)}>
              <Share2 className='w-4 h-4 mr-2' />
              Share
            </DropdownMenuItem>
            {onDelete && isOwner && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => onDelete(canvas.id)}
                  className='text-red-600 focus:text-red-600 focus:bg-red-50'
                >
                  <Trash2 className='w-4 h-4 mr-2' />
                  Delete
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {shareOpen && (
        <Dialog
          open={shareOpen}
          onOpenChange={open => !open && setShareOpen(false)}
          title='Share Canvas'
        >
          <CanvasShareModal
            key={canvas.id}
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
