import React, { useState } from 'react';
import {
  BookMarked,
  Copy,
  FileText,
  Globe,
  Lock,
  MoreHorizontal,
  Share2,
  Trash2,
} from 'lucide-react';
import { CanvasRole, CanvasVisibility, DocType } from '@xyne/shared';
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
  quartoDocOpen: string;
  actionsMenu: string;
}

export interface CanvasRowProps {
  canvas: Canvas;
  onSelect: (e: React.MouseEvent | KeyboardEvent, canvas: Canvas) => void;
  selectedCanvasId?: string | undefined;
  currentUserId?: string | undefined;
  indentClassName?: string | undefined;
  onDelete?: ((id: string) => void) | undefined;
  onDuplicate?: ((canvas: Canvas) => void) | undefined;
  trackNames: CanvasRowTrackNames;
  quartoDocIcon?: 'bookmark' | 'file';
}

export const CanvasRow: React.FC<CanvasRowProps> = ({
  canvas,
  onSelect,
  selectedCanvasId,
  currentUserId,
  indentClassName = 'pl-2',
  onDelete,
  onDuplicate,
  trackNames,
  quartoDocIcon = 'file',
}) => {
  const [shareOpen, setShareOpen] = useState(false);
  const isSelected = selectedCanvasId === canvas.id;
  const isOwner = canvas.createdBy === currentUserId;
  const isEditor = canvas.accessLevel === CanvasRole.EDITOR;
  const isQuartoDoc = canvas.docType === DocType.Quarto;
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
          data-track-name={isQuartoDoc ? trackNames.quartoDocOpen : trackNames.canvasOpen}
        >
          {isQuartoDoc && quartoDocIcon === 'bookmark' ? (
            <BookMarked className='w-4 h-4 text-blue-500 shrink-0' />
          ) : (
            <FileText className='w-4 h-4 text-muted-foreground shrink-0' />
          )}
          <div className='min-w-0 flex-1'>
            <div className='text-sm truncate'>{canvas.title || 'Untitled'}</div>
            <div className='text-xs text-muted-foreground truncate'>{createdDateText}</div>
          </div>
          {!isQuartoDoc && (
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
          )}
        </button>

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
            {!isQuartoDoc && onDuplicate && (
              <DropdownMenuItem onClick={() => onDuplicate(canvas)}>
                <Copy className='w-4 h-4 mr-2' />
                Duplicate
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              onClick={() => {
                if (isQuartoDoc && canvas.userRepo) {
                  void navigator.clipboard.writeText(
                    `${window.location.origin}/docs/${canvas.userRepo}`,
                  );
                } else {
                  setShareOpen(true);
                }
              }}
            >
              <Share2 className='w-4 h-4 mr-2' />
              {isQuartoDoc ? 'Copy Link' : 'Share'}
            </DropdownMenuItem>
            {onDelete && isOwner && !isQuartoDoc && (
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
