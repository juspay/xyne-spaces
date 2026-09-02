import { useEffect, type ReactElement } from 'react';
import { Switch } from '../ui/Switch';
import { Button } from '../ui/Button/Button';
import { useIntentSuggestionsEnabled } from '../../hooks/useIntentSuggestionsEnabled';
import { useIntentModelStatus } from '../../hooks/useIntentModelStatus';

/**
 * Settings → Developer switch for on-device intent suggestions.
 *
 * Also owns the model-download affordance. Enabling this pulls ~23MB, and an
 * unexplained 23MB — or a silent failure to fetch it — is indistinguishable from a
 * broken feature. That is not hypothetical: a missing model went unnoticed twice
 * during development precisely because nothing surfaced it.
 *
 * See docs/ON_DEVICE_INTENT.md
 */
export function IntentSuggestionsToggle(): ReactElement {
  const { intentSuggestionsEnabled, setIntentSuggestionsEnabled } = useIntentSuggestionsEnabled();
  const { status, start, retry } = useIntentModelStatus();

  // Start the download when the switch is on and nothing has been fetched yet.
  // Covers both flipping it on now and arriving with it already on.
  useEffect(() => {
    if (intentSuggestionsEnabled && status.state === 'idle') start();
  }, [intentSuggestionsEnabled, status.state, start]);

  return (
    <div className='rounded-lg border border-border bg-muted/30 p-3'>
      <div className='flex items-center justify-between gap-4'>
        <div>
          <p className='text-sm font-medium text-foreground'>Intent suggestions</p>
          <p className='mt-0.5 text-xs text-muted-foreground'>
            Suggests starting a call, creating a ticket, or adding people when a message in a public
            channel reads that way. Runs entirely on your device — nothing is sent to a server.
            Downloads a one-time ~23MB model when enabled.
          </p>
        </div>
        <Switch
          id='intent-suggestions'
          checked={intentSuggestionsEnabled}
          onCheckedChange={setIntentSuggestionsEnabled}
        />
      </div>

      {intentSuggestionsEnabled && status.state !== 'idle' ? (
        <ModelStatusRow status={status} onRetry={retry} />
      ) : null}
    </div>
  );
}

function ModelStatusRow({
  status,
  onRetry,
}: {
  status: Exclude<ReturnType<typeof useIntentModelStatus>['status'], { state: 'idle' }>;
  onRetry: () => void;
}): ReactElement | null {
  if (status.state === 'downloading') {
    return (
      <div className='mt-3 border-t border-border pt-3'>
        <div className='flex items-center justify-between gap-3'>
          <p className='text-xs text-muted-foreground'>
            {status.percent === null
              ? 'Downloading language model…'
              : `Downloading language model — ${status.percent}%`}
          </p>
          {status.percent !== null ? (
            <span className='font-mono text-xs text-muted-foreground'>{status.percent}%</span>
          ) : null}
        </div>
        <div className='mt-1.5 h-1 w-full overflow-hidden rounded-full bg-muted'>
          {/* Indeterminate until a total is known — a bar stuck at 0 reads as stalled. */}
          <div
            className={
              status.percent === null
                ? 'h-full w-1/3 animate-pulse rounded-full bg-primary/60'
                : 'h-full rounded-full bg-primary transition-[width] duration-300'
            }
            {...(status.percent !== null ? { style: { width: `${status.percent}%` } } : {})}
          />
        </div>
        <p className='mt-1 text-[11px] text-muted-foreground'>
          One time only. Suggestions start working as soon as this finishes.
        </p>
      </div>
    );
  }

  if (status.state === 'failed') {
    return (
      <div className='mt-3 border-t border-border pt-3'>
        <div className='flex items-center justify-between gap-3'>
          <div>
            <p className='text-xs font-medium text-destructive'>Could not download the model</p>
            <p className='mt-0.5 text-[11px] text-muted-foreground'>
              Suggestions stay off until this succeeds. Nothing else is affected.
            </p>
          </div>
          <Button
            type='button'
            variant='ghost'
            onClick={onRetry}
            trackId='retry_intent_model_download'
            data-track-category='Settings'
            data-track-name='Intent suggestions: retry model download'
            className='shrink-0 rounded-md border border-border px-2.5 py-1 text-xs font-medium text-foreground hover:bg-muted'
          >
            Retry
          </Button>
        </div>
      </div>
    );
  }

  return (
    <p className='mt-3 border-t border-border pt-3 text-[11px] text-muted-foreground'>
      Model ready — suggestions are active.
    </p>
  );
}
