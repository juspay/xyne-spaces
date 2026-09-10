import { ReactElement } from 'react';
import { Trash2, X, Loader2 } from 'lucide-react';
import { Tooltip } from '../../../components/ui/Tooltip';

interface RecordingsBulkActionBarProps {
  selectedCount: number;
  isPreparingAskAI: boolean;
  /** When set, the Ask AI button is disabled and this text shows as its hover tooltip */
  askAIDisabledReason?: string | undefined;
  onClear: () => void;
  onAskAI: () => void;
  onDelete: () => void;
}

/**
 * Sticky action bar shown above the recordings list when one or more
 * recordings are selected. Presentational only — all handlers live in
 * RecordingsScreen.
 */
export function RecordingsBulkActionBar({
  selectedCount,
  isPreparingAskAI,
  askAIDisabledReason,
  onClear,
  onAskAI,
  onDelete,
}: RecordingsBulkActionBarProps): ReactElement {
  const askAIButton = (
    <button
      onClick={onAskAI}
      disabled={isPreparingAskAI || !!askAIDisabledReason}
      className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
      data-track-category='RecordingsScreen'
      data-track-name='ask_ai_selected'
    >
      {isPreparingAskAI ? (
        <Loader2 className='w-4 h-4 animate-spin' />
      ) : (
        <img
          src='/svgs/icons/ai-bot-gradient-star.svg'
          width={16}
          height={16}
          alt=''
          aria-hidden='true'
        />
      )}
      Ask AI
    </button>
  );

  return (
    <div className='sticky top-0 z-30 mb-4 flex items-center justify-between gap-3 rounded-lg border border-border dark:border-gray-700 bg-background dark:bg-gray-800 px-4 py-2.5 shadow-sm'>
      <div className='flex items-center gap-2'>
        <button
          onClick={onClear}
          className='p-1 text-muted-foreground hover:text-foreground rounded-md hover:bg-muted'
          aria-label='Clear selection'
          data-track-category='RecordingsScreen'
          data-track-name='clear_selection'
        >
          <X className='w-4 h-4' />
        </button>
        <span className='text-sm font-medium text-foreground dark:text-gray-100'>
          {selectedCount} selected
        </span>
      </div>
      <div className='flex items-center gap-2'>
        {/* A disabled <button> emits no pointer events, so the tooltip trigger is
            a wrapping <span>. Uses the app Tooltip (delayDuration 0) for an instant
            hint instead of the slow native `title`. */}
        {askAIDisabledReason ? (
          <Tooltip content={askAIDisabledReason} side='top'>
            <span className='inline-flex'>{askAIButton}</span>
          </Tooltip>
        ) : (
          askAIButton
        )}
        <button
          onClick={onDelete}
          className='flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-destructive hover:text-foreground hover:bg-muted rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
          data-track-category='RecordingsScreen'
          data-track-name='delete_selected'
        >
          <Trash2 className='w-4 h-4' />
          Delete
        </button>
      </div>
    </div>
  );
}
