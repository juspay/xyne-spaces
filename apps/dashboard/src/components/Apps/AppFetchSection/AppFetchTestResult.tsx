import type { ReactElement } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../../utils/classNames';
import type { FetchConfigTestResult } from './AppFetchSection.types';
import { describeTestStage } from './AppFetchSection.utils';

interface AppFetchTestResultProps {
  result: FetchConfigTestResult;
}

/**
 * Outcome of one test fetch. Always shows the request that was sent — a failure
 * is usually a wrong URL or a body the app did not expect, and neither is
 * diagnosable from the status code alone.
 */
export const AppFetchTestResult = ({ result }: AppFetchTestResultProps): ReactElement => {
  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-md border px-3 py-2.5 text-xs',
        result.ok ? 'border-border bg-muted/40' : 'border-destructive/40 bg-destructive/5',
      )}
    >
      <div className='flex items-start gap-2'>
        {result.ok ? (
          <CheckCircle2 className='h-4 w-4 shrink-0 text-emerald-600' aria-hidden />
        ) : (
          <XCircle className='h-4 w-4 shrink-0 text-destructive' aria-hidden />
        )}
        <div className='flex flex-col gap-0.5 min-w-0'>
          <span className='font-medium'>
            {result.ok ? 'The app responded correctly' : describeTestStage(result.stage)}
          </span>
          <span className='text-muted-foreground'>
            {result.ok
              ? `${result.status} · ${result.messageCount} message${
                  result.messageCount === 1 ? '' : 's'
                } · ${result.hasNextCursor ? 'more pages available' : 'no further pages'} · ${
                  result.durationMs
                }ms`
              : result.error}
          </span>
        </div>
      </div>

      {!result.ok && result.responsePreview ? (
        <pre className='max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px] text-muted-foreground'>
          {result.responsePreview}
        </pre>
      ) : null}

      <details className='text-muted-foreground'>
        <summary className='cursor-pointer select-none'>What was sent</summary>
        <pre className='mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/60 p-2 font-mono text-[11px]'>
          {`${result.sent.method} ${result.sent.url}${
            result.sent.body ? `\n\n${result.sent.body}` : ''
          }`}
        </pre>
      </details>
    </div>
  );
};
