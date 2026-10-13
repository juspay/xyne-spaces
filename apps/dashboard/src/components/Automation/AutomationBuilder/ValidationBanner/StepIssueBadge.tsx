import { AlertTriangle } from 'lucide-react';
import { cn } from '../../../../utils/classNames';

/** Validation issue count on a step card or Flow node; the messages show on hover. */
export function StepIssueBadge({
  messages,
  className,
}: {
  messages: string[];
  className?: string;
}): React.ReactElement {
  const count = messages.length;
  return (
    <span
      title={messages.join('\n')}
      aria-label={`${count} validation ${count === 1 ? 'issue' : 'issues'}`}
      className={cn(
        'flex items-center gap-0.5 rounded-full bg-destructive/10 px-1.5 py-0.5 text-[10px] font-medium text-destructive',
        className,
      )}
    >
      <AlertTriangle className='size-3' aria-hidden='true' />
      {count}
    </span>
  );
}
