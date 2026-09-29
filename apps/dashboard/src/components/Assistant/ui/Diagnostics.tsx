import { useState, type ReactElement } from 'react';
import { formatTrace, type TraceEntry } from '../diagnostics';

/**
 * Local-only timeline of each turn: microphone, transcription, backend reply, plan, errors.
 * TODO(before-merge): remove with `DIAGNOSTICS_ENABLED`.
 */
export function Diagnostics({ trace }: { trace: TraceEntry[] }): ReactElement {
  const [copied, setCopied] = useState<'no' | 'yes' | 'failed'>('no');

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(formatTrace(trace));
      setCopied('yes');
    } catch {
      setCopied('failed');
    }
  };

  return (
    <section
      aria-label='Assistant diagnostics'
      className='w-full rounded-lg border border-border bg-muted/20 px-3 py-2 text-xs text-muted-foreground'
    >
      <div className='flex items-center justify-between gap-2'>
        <span className='font-medium text-foreground'>Diagnose · {trace.length} events</span>
        <button
          type='button'
          onClick={() => void copy()}
          disabled={trace.length === 0}
          data-track-category='VoiceMode'
          data-track-name='CopyDiagnostics'
          className='rounded border border-border px-2 py-1 font-medium text-foreground hover:bg-muted disabled:opacity-50'
        >
          {copied === 'yes' ? 'Copied' : copied === 'failed' ? 'Clipboard unavailable' : 'Copy'}
        </button>
      </div>
      {trace.length === 0 ? (
        <p className='mt-2'>Nothing yet. Hold the orb or type a request.</p>
      ) : (
        <ol className='mt-2 max-h-56 space-y-1 overflow-y-auto font-mono'>
          {trace.map(entry => (
            <li key={entry.id} className='break-words'>
              <span className='opacity-60'>{entry.at.toLocaleTimeString()}</span>{' '}
              <strong className='font-semibold text-foreground'>{entry.step}</strong> {entry.detail}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
