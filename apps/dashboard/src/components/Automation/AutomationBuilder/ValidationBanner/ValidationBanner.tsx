import { useState } from 'react';
import { AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import type { ValidationIssue } from '../../Automation.types';
import type { ValidationBannerProps } from './ValidationBanner.types';

export function ValidationBanner({
  result,
  isSaving,
  errorMessage,
  onIssueClick,
}: ValidationBannerProps): React.ReactElement {
  const [expanded, setExpanded] = useState(false);

  // A failed save can still carry validation issues; keep them listed (and
  // clickable) under the error instead of replacing them with it.
  if (errorMessage) {
    const issues = result && !result.valid ? result.issues : [];
    return (
      <div
        data-slot='automation-validation-banner'
        className={cn(
          'rounded-md border text-sm',
          'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400 dark:border-red-500/40',
        )}
      >
        <div className='flex items-center gap-2 px-4 py-3'>
          <AlertTriangle className='size-4 flex-shrink-0' />
          <span className='flex-1'>{errorMessage}</span>
        </div>
        {issues.length > 0 && (
          <IssueList
            issues={issues}
            {...(onIssueClick ? { onIssueClick } : {})}
            className='border-red-500/30 text-red-800 dark:text-red-300'
          />
        )}
      </div>
    );
  }

  if (!result) {
    return (
      <div
        data-slot='automation-validation-banner'
        className={cn(
          'flex items-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm',
          'text-muted-foreground',
        )}
      >
        {isSaving ? (
          <>
            <Loader2 className='size-4 animate-spin' />
            <span>Saving…</span>
          </>
        ) : (
          <span>No validation run yet.</span>
        )}
      </div>
    );
  }

  if (result.valid) {
    return (
      <div
        data-slot='automation-validation-banner'
        className={cn(
          'flex items-center gap-2 rounded-md border border-border bg-background px-4 py-3 text-sm',
          'text-muted-foreground',
        )}
      >
        <CheckCircle2 className='size-4 flex-shrink-0 text-green-600' />
        <span>No issues — ready to activate.</span>
        {isSaving && <Loader2 className='ml-auto size-4 animate-spin opacity-60' />}
      </div>
    );
  }

  return (
    <div
      data-slot='automation-validation-banner'
      className={cn(
        'rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300 dark:border-amber-500/40',
      )}
    >
      <button
        type='button'
        className='flex w-full items-center gap-2 px-4 py-3 text-left text-sm'
        onClick={() => setExpanded(prev => !prev)}
        data-track-category='automation-builder'
        data-track-name='validation-banner-toggle'
      >
        <AlertTriangle className='size-4 flex-shrink-0' />
        <span className='flex-1 font-medium'>
          {result.issues.length} issue{result.issues.length === 1 ? '' : 's'} to resolve
        </span>
        {expanded ? <ChevronUp className='size-4' /> : <ChevronDown className='size-4' />}
      </button>
      {expanded && (
        <IssueList
          issues={result.issues}
          {...(onIssueClick ? { onIssueClick } : {})}
          className='border-amber-500/30 text-amber-900 dark:text-amber-200'
        />
      )}
    </div>
  );
}

function IssueList({
  issues,
  onIssueClick,
  className,
}: {
  issues: ValidationIssue[];
  onIssueClick?: (issue: ValidationIssue) => void;
  className: string;
}): React.ReactElement {
  return (
    <ul className={cn('border-t px-4 py-2 text-xs', className)}>
      {issues.map((issue, index) => (
        <li key={`${issue.path}-${index}`} className='py-1'>
          {onIssueClick ? (
            <button
              type='button'
              onClick={() => onIssueClick(issue)}
              data-track-category='automation-builder'
              data-track-name='validation-banner-focus-issue'
              className='text-left hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/50 rounded'
            >
              <code className='mr-2 rounded bg-amber-500/20 dark:bg-amber-500/30 px-1.5 py-0.5 font-mono text-[10px]'>
                {issue.path || '(root)'}
              </code>
              <span>{issue.message}</span>
            </button>
          ) : (
            <>
              <code className='mr-2 rounded bg-amber-500/20 dark:bg-amber-500/30 px-1.5 py-0.5 font-mono text-[10px]'>
                {issue.path || '(root)'}
              </code>
              <span>{issue.message}</span>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
