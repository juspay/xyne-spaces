import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, GitCompare } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Skeleton } from '../../../ui/Skeleton';
import { Button } from '../../../ui/Button/Button';
import Avatar from '../../../ui/Avatar/Avatar';
import { useUser } from '../../../../hooks/useUsers';
import { fetchAutomationVersions } from '../../../../api/automationsApi';
import { isLiveStatus } from '../../Automation.types';
import type { Automation } from '../../Automation.types';
import { formatRelative, statusPillClasses } from '../../AutomationsList/AutomationsList.utils';
import { VersionDiffView } from '../VersionDiffView/VersionDiffView';
import type { VersionHistoryProps } from './VersionHistory.types';

const SKELETON_ROWS = 4;

export function VersionHistory({
  automationId,
  onOpenVersion,
  onBack,
}: VersionHistoryProps): React.ReactElement {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['automation-versions', automationId],
    queryFn: () => fetchAutomationVersions(automationId),
  });
  const [comparing, setComparing] = useState(false);

  const versions = data ?? [];

  if (comparing) {
    return (
      <VersionDiffView
        versions={versions}
        initialFromId={automationId}
        initialToId={automationId}
        onClose={() => setComparing(false)}
      />
    );
  }

  return (
    <div className='flex h-full w-full flex-col bg-background'>
      <div className='flex items-center gap-3 border-b border-border px-6 py-4'>
        <button
          type='button'
          onClick={onBack}
          aria-label='Back'
          data-track-category='automation-versions'
          data-track-name='version-history-back'
          className='flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/40'
        >
          <ArrowLeft className='size-4' />
        </button>
        <h1 className='flex-1 text-base font-semibold text-foreground'>Version history</h1>
        {versions.length > 1 && (
          <Button
            variant='outline'
            size='sm'
            onClick={() => setComparing(true)}
            data-track-category='automation-versions'
            data-track-name='version-history-compare'
          >
            <GitCompare className='size-4' />
            Compare two versions
          </Button>
        )}
      </div>

      <div role='list' aria-label='Automation versions' className='flex-1 overflow-y-auto'>
        {isError ? (
          <div className='py-16 text-center text-sm text-red-600'>
            Failed to load version history.
            <button
              type='button'
              data-track-category='automation-versions'
              data-track-name='version-history-retry'
              onClick={() => {
                void refetch();
              }}
              className='ml-2 underline hover:no-underline'
            >
              Retry
            </button>
          </div>
        ) : isLoading ? (
          <div className='flex flex-col'>
            {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <div key={i} className='flex items-center gap-3 border-b border-border px-6 py-3'>
                <Skeleton className='h-4 w-4 rounded-full flex-shrink-0' />
                <Skeleton className='h-3.5 w-40' />
                <Skeleton className='h-3.5 w-14 ml-2' />
                <div className='flex-1' />
                <Skeleton className='h-3 w-32' />
              </div>
            ))}
          </div>
        ) : versions.length === 0 ? (
          <div className='py-16 text-center text-sm text-muted-foreground'>
            No version history found.
          </div>
        ) : (
          versions.map(version => (
            <VersionRow
              key={version.id}
              version={version}
              isCurrent={version.id === automationId}
              onClick={() => onOpenVersion(version)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function VersionRow({
  version,
  isCurrent,
  onClick,
}: {
  version: Automation;
  isCurrent: boolean;
  onClick: () => void;
}): React.ReactElement {
  const creator = useUser(version.createdById);

  return (
    <button
      type='button'
      onClick={onClick}
      data-track-category='automation-versions'
      data-track-name='version-history-row-open'
      className='flex h-16 w-full items-center gap-3 border-b border-border px-6 text-left hover:bg-accent/30'
    >
      <div className='flex flex-1 flex-col gap-0.5 min-w-0'>
        <div className='flex items-center gap-2'>
          <span
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              statusPillClasses(version.status),
            )}
          >
            {version.status}
          </span>
          {isLiveStatus(version.status) && (
            <span className='rounded-full border border-green-500/30 bg-green-500/10 px-2 py-0.5 text-[10px] font-medium text-green-700 dark:text-green-400'>
              Live
            </span>
          )}
          {isCurrent && (
            <span className='rounded-full border border-border px-2 py-0.5 text-[10px] font-medium text-muted-foreground'>
              Viewing
            </span>
          )}
        </div>
        {version.createdById && (
          <span className='inline-flex items-center gap-1.5 text-[11px] text-muted-foreground'>
            <Avatar userId={version.createdById} size='xs' />
            <span>{creator?.name ?? creator?.email ?? 'unknown'}</span>
          </span>
        )}
      </div>
      <div className='flex flex-col items-end gap-0.5 text-xs text-muted-foreground'>
        <span>Created {formatRelative(version.createdAt)}</span>
      </div>
    </button>
  );
}
