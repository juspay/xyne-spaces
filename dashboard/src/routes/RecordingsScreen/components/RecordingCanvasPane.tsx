/**
 * RecordingCanvasPane - Right pane of the recording split view.
 * Hosts a live collaborative canvas for notes taken during an active recording.
 * Only mounted after the user creates a canvas (see RecordingsScreen split layout).
 */

import { KeyboardEvent, ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Loader2, X } from 'lucide-react';
import { CollaborativeCanvasEditor } from '../../../components/Canvas/CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { canvasService } from '../../../services/Canvas/canvasService';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { logger, Event as LoggerEvent } from '../../../utils/logger';
import { toast } from 'sonner';

interface RecordingCanvasPaneProps {
  channelId: string | null;
  notesCanvasId: string;
  notesCanvasViewAccessId: string;
  title: string;
  onTitleChange: (title: string) => void;
  onClose?: () => void;
}

export function RecordingCanvasPane({
  channelId,
  notesCanvasId,
  notesCanvasViewAccessId,
  title,
  onTitleChange,
  onClose,
}: RecordingCanvasPaneProps): ReactElement {
  const z = useZero();
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(title);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  const didCancelTitleEditRef = useRef(false);

  const handleFileUpload = useCallback(
    (file: File): Promise<string> => canvasService.uploadCanvasFile(notesCanvasId, file),
    [notesCanvasId],
  );

  useEffect(() => {
    setDraftTitle(title);
  }, [title]);

  useEffect(() => {
    if (isEditingTitle) {
      didCancelTitleEditRef.current = false;
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }

    return () => {
      didCancelTitleEditRef.current = false;
    };
  }, [isEditingTitle]);

  const saveTitle = useCallback(async (): Promise<void> => {
    if (isSavingTitle) return;

    const nextTitle = draftTitle.trim() || 'Untitled Notes';
    if (nextTitle === title) {
      setDraftTitle(title);
      setIsEditingTitle(false);
      return;
    }

    setIsSavingTitle(true);
    try {
      const result = z.mutate(
        mutators.canvas.update({
          id: notesCanvasId,
          title: nextTitle,
          timestamp: Date.now(),
        }),
      );
      const serverResult = await result.server;
      if (serverResult.type === 'error') {
        throw new Error(serverResult.error?.message ?? 'Failed to update notes canvas title');
      }

      onTitleChange(nextTitle);
      setDraftTitle(nextTitle);
      setIsEditingTitle(false);
    } catch (error) {
      logger.error(LoggerEvent.API_CALL_FAILED, {
        message: 'Failed to update notes canvas title',
        canvasId: notesCanvasId,
        error: error instanceof Error ? error.message : String(error),
      });
      setDraftTitle(title);
      toast.error('Failed to update notes title. Please try again.');
    } finally {
      setIsSavingTitle(false);
    }
  }, [draftTitle, isSavingTitle, notesCanvasId, onTitleChange, title, z]);

  const cancelTitleEdit = useCallback((): void => {
    didCancelTitleEditRef.current = true;
    setDraftTitle(title);
    setIsEditingTitle(false);
  }, [title]);

  const handleTitleKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void saveTitle();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      cancelTitleEdit();
    }
  };

  return (
    <div className='flex flex-col h-full overflow-hidden'>
      {/* Header — mirrors ActiveRecordingView's header rhythm */}
      <div className='h-[72px] px-6 border-b border-input dark:border-gray-700 flex items-center justify-between gap-3'>
        <div className='flex items-center gap-2 min-w-0'>
          <FileText className='w-4 h-4 text-muted-foreground flex-shrink-0' />
          {isEditingTitle ? (
            <>
              <input
                ref={titleInputRef}
                value={draftTitle}
                onChange={event => setDraftTitle(event.target.value)}
                onKeyDown={handleTitleKeyDown}
                onBlur={() => {
                  if (didCancelTitleEditRef.current) {
                    didCancelTitleEditRef.current = false;
                    return;
                  }
                  void saveTitle();
                }}
                disabled={isSavingTitle}
                className='h-8 min-w-0 max-w-full rounded-md border border-border bg-background px-2 pr-8 text-sm font-medium text-foreground outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-400/20 disabled:opacity-70 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100'
                aria-label='Edit notes title'
                data-track-category='RecordingsScreen'
                data-track-name='edit_notes_canvas_title_input'
              />
              {isSavingTitle && (
                <Loader2 className='-ml-7 h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground' />
              )}
            </>
          ) : (
            <button
              type='button'
              onClick={() => {
                didCancelTitleEditRef.current = false;
                setIsEditingTitle(true);
              }}
              className='min-w-0 truncate rounded-md px-1 py-1 text-left text-sm font-medium text-foreground transition-colors hover:bg-muted dark:text-gray-100 dark:hover:bg-gray-700'
              title='Edit notes title'
              data-track-category='RecordingsScreen'
              data-track-name='edit_notes_canvas_title'
            >
              {title}
            </button>
          )}
        </div>
        {onClose && (
          <button
            type='button'
            onClick={onClose}
            className='flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground dark:hover:bg-gray-700'
            aria-label='Close canvas'
            title='Close canvas'
            data-track-category='RecordingsScreen'
            data-track-name='close_notes_canvas'
          >
            <X className='h-4 w-4' />
          </button>
        )}
      </div>

      {/* Collaborative editor — synced via Y-Sweet CRDT */}
      <div className='flex-1 overflow-auto'>
        <CollaborativeCanvasEditor
          canvasId={notesCanvasId}
          channelId={channelId ?? undefined}
          viewAccessId={notesCanvasViewAccessId}
          editable
          autoFocus
          placeholder='Jot down notes while you record…'
          onFileUpload={handleFileUpload}
        />
      </div>
    </div>
  );
}
