import { type ReactElement } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/Button';
import { formatDiagnostics, type VoiceDiagnostic } from './diagnoseLog';

/** What happened in each voice turn, step by step, with timings. Local only. */
export function DiagnosePanel({ events }: { events: VoiceDiagnostic[] }): ReactElement {
  const copy = (): void => {
    navigator.clipboard.writeText(formatDiagnostics(events)).then(
      () => toast.success('Diagnostics copied'),
      () => toast.error('Could not copy to the clipboard'),
    );
  };

  return (
    <section
      aria-label='Voice diagnostics'
      className='flex min-h-0 flex-1 flex-col gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs'
    >
      <div className='flex items-center justify-between gap-2'>
        <span className='font-medium text-foreground'>Diagnose · {events.length} events</span>
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={events.length === 0}
          onClick={copy}
        >
          Copy
        </Button>
      </div>
      {events.length === 0 ? (
        <p className='text-muted-foreground'>Nothing yet. Hold the orb to talk.</p>
      ) : (
        <ol className='min-h-0 flex-1 space-y-1 overflow-y-auto font-mono text-muted-foreground'>
          {events.map(event => (
            <li key={event.id} className='break-words'>
              <span className='opacity-60'>
                {event.at.toLocaleTimeString()} +{event.ms}ms
              </span>{' '}
              <strong className='font-semibold text-foreground'>{event.step}</strong> {event.detail}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
