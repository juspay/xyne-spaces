import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, GitCompare, Info } from 'lucide-react';
import { cn } from '../../../../utils/classNames';
import { Skeleton } from '../../../ui/Skeleton';
import { Button } from '../../../ui/Button/Button';
import Avatar from '../../../ui/Avatar/Avatar';
import { useUser } from '../../../../hooks/useUsers';
import { fetchAutomationVersions } from '../../../../api/automationsApi';
import { isLiveStatus } from '../../Automation.types';
import type { Automation } from '../../Automation.types';
import { formatRelative, statusPillClasses } from '../../AutomationsList/AutomationsList.utils';
import type { VersionHistoryProps } from './VersionHistory.types';

const SKELETON_ROWS = 4;

export function VersionHistory({
  automationId,
  onOpenVersion,
  onCompare,
  onBack,
}: VersionHistoryProps): React.ReactElement {
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['automation-versions', automationId],
    queryFn: () => fetchAutomationVersions(automationId),
  });

  const versions = data ?? [];

  const handleCompareClick = (): void => {
    // Default the comparison to the current version against its nearest
    // neighbor — defaulting both sides to `automationId` would open the
    // diff view showing a version compared against itself.
    const currentIndex = versions.findIndex(v => v.id === automationId);
    const defaultToId =
      (currentIndex >= 0 ? (versions[currentIndex + 1] ?? versions[currentIndex - 1])?.id : null) ??
      automationId;
    onCompare(automationId, defaultToId);
  };

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
            onClick={handleCompareClick}
            data-track-category='automation-versions'
            data-track-name='version-history-compare'
          >
            <GitCompare className='size-4' />
            Compare two versions
          </Button>
        )}
      </div>

      {versions.length > 0 && (
        <div className='flex items-start gap-2 border-b border-border bg-muted/30 px-6 py-2.5 text-xs text-muted-foreground'>
          <Info className='mt-0.5 size-3.5 flex-shrink-0' aria-hidden='true' />
          <span>
            To bring back an older version, open it below and use <strong>Clone</strong> — that
            starts a new proposal seeded with that version&apos;s config.
          </span>
        </div>
      )}

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
