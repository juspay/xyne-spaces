import type { ReactElement } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { Message } from '../utils/XyneAITypes';
import { cn } from '../../../../utils/classNames';

/**
 * Why an assistant turn failed: title, code, message, help text and the raw
 * backend error behind a disclosure. Shared by the Ask AI sidebar and the
 * AI screen so a failed reply never ends silently after its steps.
 */
export function TurnErrorCard({
  errorInfo,
  className,
}: {
  errorInfo: NonNullable<Message['errorInfo']>;
  className?: string;
}): ReactElement {
  return (
    <div
      role='alert'
      className={cn('border border-destructive/20 bg-destructive/5 p-3', className)}
    >
      <div className='flex items-start gap-2'>
        <AlertTriangle size={14} className='mt-0.5 shrink-0 text-destructive' />
        <div className='flex-1 min-w-0'>
          <div className='text-xs font-medium text-destructive'>
            {errorInfo.title}
            {errorInfo.code && (
              <span className='ml-1 text-[10px] opacity-70'>({errorInfo.code})</span>
            )}
          </div>
          <div className='mt-0.5 text-xs text-muted-foreground'>{errorInfo.message}</div>
          {errorInfo.helpText && (
            <div className='mt-1 text-[11px] text-muted-foreground/80'>{errorInfo.helpText}</div>
          )}
          {errorInfo.rawError && (
            <details className='mt-2'>
              <summary className='text-[10px] text-muted-foreground/60 cursor-pointer hover:text-muted-foreground'>
                Technical details
              </summary>
              <pre className='mt-1 max-h-32 overflow-y-auto rounded bg-muted p-2 text-[10px] text-muted-foreground whitespace-pre-wrap break-all'>
                {errorInfo.rawError}
              </pre>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
