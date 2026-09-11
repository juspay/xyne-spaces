import React from 'react';

interface DeleteTranscriptToggleProps {
  deleteTranscript: boolean;
  onChange: (deleteTranscript: boolean) => void;
  disabled?: boolean;
  error?: string | null;
}

/**
 * Opt-in "Delete transcript" toggle shown at end-of-call when the host paused
 * transcription during the call. Default OFF = keep (the safe default); ON = discard.
 */
export function DeleteTranscriptToggle({
  deleteTranscript,
  onChange,
  disabled = false,
  error = null,
}: DeleteTranscriptToggleProps): React.ReactElement {
  return (
    <div className='rounded-lg border border-border bg-muted/40 p-3'>
      <div className='flex items-start justify-between gap-3'>
        <label htmlFor='delete-transcript-toggle' className='min-w-0 cursor-pointer'>
          <span className='block text-[13px] font-medium text-foreground'>Delete transcript</span>
          <span className='mt-0.5 block text-xs leading-relaxed text-muted-foreground'>
            Since you paused transcription during the call, do you want to delete the transcript for
            the duration it was recorded?
          </span>
        </label>
        <input
          id='delete-transcript-toggle'
          type='checkbox'
          checked={deleteTranscript}
          disabled={disabled}
          onChange={event => onChange(event.target.checked)}
          aria-label='Delete transcript'
          data-testid='delete-transcript-toggle'
          data-track-category='CALLS'
          data-track-name='DELETE_TRANSCRIPT_TOGGLE'
          className='mt-0.5 h-4 w-4 flex-shrink-0 accent-[var(--destructive)]'
        />
      </div>
      {error && <p className='mt-2 text-xs text-destructive'>{error}</p>}
    </div>
  );
}
