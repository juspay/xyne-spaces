/**
 * RecordingCanvasPane - Notes panel for the recording workspace.
 * Hosts a live collaborative canvas for notes taken during an active recording.
 * The main header (view switcher) is handled by RecordingWorkspaceHeader.
 */

import { KeyboardEvent, ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import { CollaborativeCanvasEditor } from '../../../components/Canvas/CollaborativeCanvasEditor/CollaborativeCanvasEditor';
import { canvasService } from '../../../services/Canvas/canvasService';
import { useZero } from '../../../hooks/useZero';
import { mutators } from '../../../zero/mutators';
import { useRecordingStore, sendRecordingEvent } from '../../../hooks/useRecordingStore';
import { logger, Event as LoggerEvent } from '../../../utils/logger';
import { toast } from 'sonner';
import { cn } from '../../../utils/classNames';
import { DEFAULT_NOTES_TITLE } from '../../../stores/recordingStore';

interface RecordingCanvasPaneProps {
  channelId: string | null;
  notesCanvasId: string;
}

export function RecordingCanvasPane({
  channelId,
  notesCanvasId,
}: RecordingCanvasPaneProps): ReactElement {
  const z = useZero();
  const titleInputRef = useRef<HTMLInputElement | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [isSavingTitle, setIsSavingTitle] = useState(false);
  // Track if Escape was pressed to skip save on blur
  const skipBlurSaveRef = useRef(false);

  const canvasTitle = useRecordingStore(ctx => ctx.notesCanvasTitle);

  const [draftTitle, setDraftTitle] = useState(canvasTitle);

  const handleFileUpload = useCallback(
    (file: File): Promise<string> => canvasService.uploadCanvasFile(notesCanvasId, file),
    [notesCanvasId],
  );

  // Sync draft title when store title changes
  useEffect(() => {
    setDraftTitle(canvasTitle);
  }, [canvasTitle]);

  // Focus and select title input when editing starts
  useEffect(() => {
    if (isEditingTitle) {
      titleInputRef.current?.focus();
      titleInputRef.current?.select();
    }
  }, [isEditingTitle]);

  const saveTitle = useCallback(async (): Promise<void> => {
    if (isSavingTitle) return;

    const nextTitle = draftTitle.trim() || DEFAULT_NOTES_TITLE;
    if (nextTitle === canvasTitle) {
      setDraftTitle(canvasTitle);
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

      // Update app state in recording store
      sendRecordingEvent({ type: 'setNotesCanvasTitle', title: nextTitle });
      setDraftTitle(nextTitle);
      setIsEditingTitle(false);
    } catch (error) {
      logger.error(LoggerEvent.API_CALL_FAILED, {
        message: 'Failed to update notes canvas title',
        canvasId: notesCanvasId,
        error: error instanceof Error ? error.message : String(error),
      });
      setDraftTitle(canvasTitle);
      toast.error('Failed to update notes title. Please try again.');
    } finally {
      setIsSavingTitle(false);
    }
  }, [draftTitle, canvasTitle, isSavingTitle, notesCanvasId, z]);

  const cancelTitleEdit = useCallback((): void => {
    skipBlurSaveRef.current = true;
    setDraftTitle(canvasTitle);
    setIsEditingTitle(false);
  }, [canvasTitle]);

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
    <div className='flex flex-col h-full overflow-hidden bg-secondary/50'>
      {/* Notes Sub-header */}
      <div className='flex-none flex items-center justify-between pt-3 pb-2 px-5'>
        <div className='flex items-center gap-1.5 min-w-0'>
          <Layers className='size-4 text-muted-foreground flex-shrink-0' />
          <div className='relative flex items-center gap-2'>
            <input
              ref={titleInputRef}
              value={draftTitle}
              onChange={event => setDraftTitle(event.target.value)}
              onKeyDown={handleTitleKeyDown}
              onFocus={() => setIsEditingTitle(true)}
              onBlur={() => {
                if (skipBlurSaveRef.current) {
                  skipBlurSaveRef.current = false;
                  return;
                }
                void saveTitle();
              }}
              disabled={isSavingTitle}
              style={{
                width: `calc(${draftTitle.length}ch * 0.75)`,
                minWidth: '4ch',
                maxWidth: '300px',
              }}
              className={cn(
                'h-6 rounded text-sm font-semibold text-foreground',
                'outline-none transition-colors duration-150',
                isEditingTitle
                  ? 'bg-accent text-foreground'
                  : 'bg-transparent hover:bg-muted/50 cursor-pointer',
                'disabled:opacity-70 disabled:cursor-not-allowed',
              )}
              aria-label='Edit notes title'
              data-track-category='RecordingsScreen'
              data-track-name='edit_notes_canvas_title_input'
            />
            {isSavingTitle && (
              <Loader2 className='size-3 flex-shrink-0 animate-spin text-muted-foreground' />
            )}
            <span className='text-xs text-muted-foreground whitespace-nowrap'>
              {isSavingTitle ? 'Saving...' : canvasTitle !== DEFAULT_NOTES_TITLE ? 'Edited' : null}
            </span>
          </div>
        </div>
      </div>

      {/* Collaborative editor — wrapped in a centered container */}
      <div className='flex-1 min-h-0 overflow-hidden flex justify-center px-4'>
        <div className='w-full max-w-5xl flex flex-col'>
          {/* Card wrapper — no border/radius to feel like content continues */}
          <div className='flex-1 min-h-0 overflow-auto bg-card flex flex-col rounded-t-xl border border-border'>
            <CollaborativeCanvasEditor
              canvasId={notesCanvasId}
              channelId={channelId ?? undefined}
              editable
              autoFocus
              placeholder="Type '/' for commands"
              onFileUpload={handleFileUpload}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
