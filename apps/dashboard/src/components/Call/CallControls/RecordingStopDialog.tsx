import { useEffect, useRef, useState, type ReactElement } from 'react';

export interface RecordingStopDialogProps {
  /** Prefilled name, e.g. "Recording 1". */
  defaultName: string;
  /** Confirm: save with the (possibly edited) name. Empty falls back to the prefill. */
  onConfirm: (name: string) => void | Promise<void>;
  /** Dismiss without renaming — the recording still stops, name stays as-is. */
  onDismiss: () => void;
}

/**
 * Shown when a recording is stopped: lets the user name/rename it (prefilled
 * "Recording N"). Dismissing keeps the prefilled name — the recording is still
 * saved either way.
 */
export function RecordingStopDialog({
  defaultName,
  onConfirm,
  onDismiss,
}: RecordingStopDialogProps): ReactElement {
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleConfirm = async (): Promise<void> => {
    if (saving) return;
    setSaving(true);
    try {
      await onConfirm(name.trim() || defaultName);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className='fixed inset-0 z-[1000] flex items-center justify-center'>
      {/* Backdrop — a native button so click-to-dismiss is keyboard/screen-reader accessible */}
      <button
        type='button'
        aria-label='Dismiss'
        className='absolute inset-0 bg-black/50'
        onClick={onDismiss}
        data-track-category='CALLS'
        data-track-name='RECORDING_RENAME_DISMISS_BACKDROP'
      />
      <div
        role='dialog'
        aria-modal='true'
        aria-label='Name this recording'
        className='relative w-[min(92vw,400px)] rounded-xl bg-gray-800 p-5 shadow-2xl'
      >
        <h3 className='text-sm font-semibold text-white'>Name this recording</h3>
        <p className='mt-1 text-xs text-gray-400'>
          Give the recording a name so it&apos;s easy to find in the thread.
        </p>
        <input
          ref={inputRef}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') void handleConfirm();
            if (e.key === 'Escape') onDismiss();
          }}
          className='mt-3 w-full rounded-lg bg-gray-900 px-3 py-2 text-sm text-white outline-none ring-1 ring-gray-700 focus:ring-blue-500'
          placeholder={defaultName}
          data-track-category='CALLS'
          data-track-name='RECORDING_RENAME_INPUT'
        />
        <div className='mt-4 flex justify-end gap-2'>
          <button
            onClick={onDismiss}
            disabled={saving}
            className='rounded-lg px-3 py-1.5 text-sm text-gray-300 hover:bg-gray-700 disabled:opacity-50'
            data-track-category='CALLS'
            data-track-name='RECORDING_RENAME_SKIP'
          >
            Skip
          </button>
          <button
            onClick={() => void handleConfirm()}
            disabled={saving}
            className='rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50'
            data-track-category='CALLS'
            data-track-name='RECORDING_RENAME_SAVE'
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
