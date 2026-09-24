import { useCallback, useEffect, useState } from 'react';
import { NotebookPen, X } from 'lucide-react';
import { CollaborativeCanvasEditor } from '../../Canvas/CollaborativeCanvasEditor';
import { canvasService } from '../../../services/Canvas/canvasService';
import { callService } from '../../../services/Call/callService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { logger, Event } from '../../../utils/logger';

interface CallNotesPanelProps {
  callId: string;
  channelId: string | null;
  onClose: () => void;
}

type NotesState =
  | { status: 'loading' }
  | { status: 'ready'; canvasId: string; isSeriesCanvas: boolean }
  | { status: 'error'; message: string };

export function CallNotesPanel({
  callId,
  channelId,
  onClose,
}: CallNotesPanelProps): React.ReactElement {
  const [state, setState] = useState<NotesState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading' });
    callService
      .getOrCreateNotesCanvas(callId)
      .then(({ canvasId, isSeriesCanvas }) => {
        if (!cancelled) setState({ status: 'ready', canvasId, isSeriesCanvas });
      })
      .catch((error: unknown) => {
        logger.error(Event.API_CALL_FAILED, {
          message: 'Failed to open call notes canvas',
          callId,
          error: error instanceof Error ? error.message : String(error),
        });
        if (!cancelled) {
          setState({
            status: 'error',
            message: getApiErrorMessage(error, 'Failed to open notes'),
          });
        }
      });
    return (): void => {
      cancelled = true;
    };
  }, [callId, attempt]);

  const canvasId = state.status === 'ready' ? state.canvasId : null;
  const handleFileUpload = useCallback(
    (file: File): Promise<string> => canvasService.uploadCanvasFile(canvasId!, file),
    [canvasId],
  );

  return (
    <div className='flex flex-col h-full bg-background text-foreground'>
      <div className='flex items-center justify-between px-4 py-3 border-b border-border'>
        <div className='flex items-center gap-2 min-w-0'>
          <NotebookPen size={20} className='text-muted-foreground flex-shrink-0' />
          <div className='min-w-0'>
            <h2 className='text-lg font-semibold'>Notes</h2>
            {state.status === 'ready' && state.isSeriesCanvas && (
              <p className='text-xs text-muted-foreground truncate'>
                Shared across all sessions of this recurring call
              </p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className='p-1 hover:bg-muted rounded-full transition-colors'
          title='Close'
          data-track-category='CALLS'
          data-track-name='CLOSE_CALL_NOTES'
        >
          <X size={20} className='text-muted-foreground' />
        </button>
      </div>

      <div className='flex-1 min-h-0 overflow-hidden'>
        {state.status === 'loading' && (
          <div className='flex h-full items-center justify-center'>
            <p className='text-sm text-muted-foreground'>Opening notes…</p>
          </div>
        )}
        {state.status === 'error' && (
          <div className='flex h-full flex-col items-center justify-center gap-3 px-6 text-center'>
            <p className='text-sm text-muted-foreground'>{state.message}</p>
            <button
              onClick={() => setAttempt(n => n + 1)}
              className='text-sm font-medium text-primary hover:underline'
              data-track-category='CALLS'
              data-track-name='RETRY_CALL_NOTES'
            >
              Try again
            </button>
          </div>
        )}
        {state.status === 'ready' && (
          <CollaborativeCanvasEditor
            key={state.canvasId}
            canvasId={state.canvasId}
            channelId={channelId ?? undefined}
            editable
            autoFocus
            placeholder='Add notes for this call. They are used as context for the call summary.'
            onFileUpload={handleFileUpload}
            className='h-full w-full [&_.bn-editor]:!px-4'
          />
        )}
      </div>
    </div>
  );
}
