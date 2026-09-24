import { ReactElement, useEffect, useMemo, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight, History, Search } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import Input from '../../ui/Input/Input';
import { Button } from '../../ui/Button/Button';
import { HoverCard } from '../../ui/HoverCard';
import { cn } from '../../../utils/classNames';
import type { AuditEntityType, AuditLogChange } from '@xyne/shared';

interface AuditLogSectionProps {
  entityType: AuditEntityType;
  entityId: string;
}

const PAGE_SIZE = 10;

interface AuditCursor {
  createdAt: number;
  id: string;
}

type ActionFilter = 'all' | 'CREATE' | 'UPDATE' | 'DELETE';

const ACTION_FILTERS: { value: ActionFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'CREATE', label: 'Added' },
  { value: 'UPDATE', label: 'Changed' },
  { value: 'DELETE', label: 'Removed' },
];

const ACTION_VALUE_CLASSES: Record<string, string> = {
  CREATE: 'text-emerald-600 dark:text-emerald-400',
  UPDATE: 'text-amber-600 dark:text-amber-400',
  DELETE: 'text-red-600 dark:text-red-400',
};

const actionValueClass = (action: string): string =>
  ACTION_VALUE_CLASSES[action] ?? ACTION_VALUE_CLASSES['UPDATE']!;

const humanizeField = (field: string): string =>
  field
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, char => char.toUpperCase())
    .trim();

/** Values longer than this lose their inline readability — hover reveals the full text. */
const LONG_VALUE_THRESHOLD = 48;

const AuditValueText = ({ value, className }: { value: string; className: string }): ReactElement => {
  if (value.length <= LONG_VALUE_THRESHOLD) {
    return <span className={cn('min-w-0 truncate', className)}>{value}</span>;
  }
  return (
    <HoverCard
      trigger={
        <span
          className={cn(
            'min-w-0 cursor-help truncate underline decoration-dotted decoration-muted-foreground/40 underline-offset-2',
            className,
          )}
        >
          {value}
        </span>
      }
      side='right'
      align='start'
      sideOffset={6}
      openDelay={150}
      closeDelay={100}
      className='z-[60] w-80 rounded-lg p-3'
    >
      <span className='block max-h-48 overflow-y-auto break-all font-mono text-[11px] leading-relaxed text-popover-foreground'>
        {value}
      </span>
    </HoverCard>
  );
};

const AuditChangeRow = ({ change }: { change: AuditLogChange }): ReactElement => (
  <li className='flex items-center justify-between gap-3 border-b border-dashed border-border py-1 text-xs last:border-b-0'>
    <span className='min-w-0 shrink font-medium text-muted-foreground'>
      {humanizeField(change.field)}
    </span>
    <span className='flex min-w-0 max-w-[60%] shrink items-center justify-end gap-1.5 font-mono text-[11px] tabular-nums'>
      {change.action === 'DELETE' ? (
        <AuditValueText
          value={change.oldValue ?? ''}
          className='text-red-600/70 line-through dark:text-red-400/70'
        />
      ) : (
        <>
          {change.oldValue !== null && change.oldValue !== undefined && (
            <AuditValueText
              value={change.oldValue}
              className='text-muted-foreground/60 line-through'
            />
          )}
          {change.action === 'UPDATE' && <span className='shrink-0 text-muted-foreground/60'>→</span>}
          {change.newValue !== null && change.newValue !== undefined && (
            <AuditValueText
              value={change.newValue}
              className={cn('font-medium', actionValueClass(change.action))}
            />
          )}
        </>
      )}
    </span>
  </li>
);

interface ChangeGroup {
  targetName: string;
  changes: AuditLogChange[];
}

export const AuditLogSection = ({ entityType, entityId }: AuditLogSectionProps): ReactElement => {
  const [fetchCursor, setFetchCursor] = useState<AuditCursor | null>(null);
  const [nextCursor, setNextCursor] = useState<AuditCursor | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');

  const auditQuery = useMemo(
    () =>
      queries.getEntityAuditLogs({
        entityType,
        entityId,
        limit: PAGE_SIZE,
        start: fetchCursor,
      }),
    [entityType, entityId, fetchCursor],
  );
  const [auditLogsPage, auditLogsDetails] = useCachedQuery(auditQuery);
  const [accumulatedLogs, setAccumulatedLogs] = useState<typeof auditLogsPage>([]);

  // Reset pagination when the audited entity changes
  useEffect(() => {
    setFetchCursor(null);
    setAccumulatedLogs([]);
    setNextCursor(null);
    setHasMore(true);
  }, [entityType, entityId]);

  // Accumulate completed pages; the first page replaces, later pages append
  useEffect(() => {
    if (auditLogsDetails.type !== 'complete') return;

    setAccumulatedLogs(previous => {
      if (fetchCursor === null) return auditLogsPage;
      const seenIds = new Set(previous.map(log => log.id));
      return [...previous, ...auditLogsPage.filter(log => !seenIds.has(log.id))];
    });

    setHasMore(auditLogsPage.length >= PAGE_SIZE);
    const lastRow = auditLogsPage[auditLogsPage.length - 1];
    setNextCursor(lastRow ? { createdAt: lastRow.createdAt, id: lastRow.id } : null);
  }, [auditLogsPage, auditLogsDetails.type, fetchCursor]);

  const isPageLoading = auditLogsDetails.type !== 'complete';

  const handleLoadMore = (): void => {
    if (!hasMore || isPageLoading || !nextCursor) return;
    setFetchCursor(nextCursor);
  };

  const toggleExpanded = (logId: string): void => {
    setExpandedLogIds(previous => {
      const next = new Set(previous);
      if (next.has(logId)) {
        next.delete(logId);
      } else {
        next.add(logId);
      }
      return next;
    });
  };

  const entries = useMemo(
    () =>
      accumulatedLogs.map(log => {
        // Group children by the changed row's label, in first-seen order
        const groups: ChangeGroup[] = [];
        const groupByName = new Map<string, ChangeGroup>();
        for (const change of log.changes) {
          let group = groupByName.get(change.targetName);
          if (!group) {
            group = { targetName: change.targetName, changes: [] };
            groupByName.set(change.targetName, group);
            groups.push(group);
          }
          group.changes.push(change);
        }
        const targetNames = groups.map(group => group.targetName);
        const actorName = log.actorUser?.displayName || log.actorUser?.name || 'System';
        // The summary is built server-side ("Updated board configuration for X");
        // lowercase the leading verb so it reads as a sentence after the actor name.
        const summaryText = log.summary.charAt(0).toLowerCase() + log.summary.slice(1);
        return {
          log,
          groups,
          summaryText,
          actorName,
          searchText: `${actorName} ${log.summary} ${targetNames.join(' ')}`.toLowerCase(),
        };
      }),
    [accumulatedLogs],
  );

  const visibleEntries = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return entries.filter(
      entry =>
        (searchTerm === '' || entry.searchText.includes(searchTerm)) &&
        (actionFilter === 'all' ||
          entry.log.changes.some(change => change.action === actionFilter)),
    );
  }, [entries, search, actionFilter]);

  return (
    <div className='rounded-2xl border border-border bg-card p-4'>
      <div className='mb-3'>
        <h2 className='text-sm font-semibold text-foreground'>Recent changes</h2>
        <p className='mt-1 text-[13px] leading-[1.4] text-muted-foreground'>
          Every change made to this configuration.
        </p>
      </div>

      {accumulatedLogs.length === 0 && !isPageLoading ? (
        <div className='flex flex-col items-center gap-2 border-t border-border py-8'>
          <History className='size-5 text-muted-foreground/50' />
          <p className='text-[13px] text-muted-foreground'>No changes yet.</p>
        </div>
      ) : (
        <>
          <div className='mb-3 flex items-center gap-2'>
            <div className='relative min-w-0 flex-1'>
              <Search className='pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/60' />
              <Input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder='Search by person, bot, or board…'
                className='h-8 pl-8 text-xs'
                data-track-category='UserGroups'
                data-track-name='SearchAuditLogs'
              />
            </div>
            <div className='flex shrink-0 items-center gap-1.5'>
              {ACTION_FILTERS.map(filter => (
                <button
                  key={filter.value}
                  type='button'
                  aria-pressed={actionFilter === filter.value}
                  onClick={() => setActionFilter(filter.value)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-xs font-medium transition-colors',
                    actionFilter === filter.value
                      ? 'border-primary/50 bg-primary/10 text-primary'
                      : 'border-border text-muted-foreground hover:border-border/60 hover:text-foreground',
                  )}
                  data-track-category='UserGroups'
                  data-track-name='FilterAuditLogs'
                  data-track-metadata={JSON.stringify({ filter: filter.value })}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </div>

          {visibleEntries.length === 0 ? (
            <div className='flex flex-col items-center gap-2 border-t border-border py-8'>
              <Search className='size-4 text-muted-foreground/50' />
              <p className='text-xs text-muted-foreground'>No changes match your filters.</p>
            </div>
          ) : (
            <div className='overflow-hidden rounded-lg border border-border animate-fade-in'>
              {visibleEntries.map(({ log, groups, summaryText, actorName }) => {
                const isExpanded = expandedLogIds.has(log.id);
                return (
                  <div key={log.id} className='border-b border-border last:border-b-0'>
                    <button
                      type='button'
                      onClick={() => toggleExpanded(log.id)}
                      className='flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/40'
                      data-track-category='UserGroups'
                      data-track-name='ToggleAuditLogEntry'
                    >
                      <Avatar userId={log.actorUserId ?? null} size='sm' showActiveStatus={false} />
                      <span className='min-w-0 flex-1'>
                        <span className='block truncate text-xs leading-[1.45]'>
                          <span className='font-semibold text-foreground'>{actorName}</span>{' '}
                          <span className='text-muted-foreground'>{summaryText}</span>
                        </span>
                        <span className='mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground/80'>
                          <span className='tabular-nums'>
                            {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                          </span>
                          <span aria-hidden>•</span>
                          <span className='rounded border border-border bg-muted/50 px-1.5 py-px text-[10px] font-medium tabular-nums'>
                            {log.changes.length} {log.changes.length === 1 ? 'change' : 'changes'}
                          </span>
                        </span>
                      </span>
                      <ChevronRight
                        className={cn(
                          'size-4 shrink-0 text-muted-foreground/60 transition-transform duration-200',
                          isExpanded && 'rotate-90 text-foreground',
                        )}
                      />
                    </button>

                    {/* Smooth height animation via grid-rows transition */}
                    <div
                      className={cn(
                        'grid transition-[grid-template-rows] duration-200 ease-out',
                        isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
                      )}
                    >
                      <div className='min-h-0 overflow-hidden'>
                        <div className='space-y-2 bg-muted/30 px-3 pb-3 pt-2'>
                          {groups.map(group => (
                            <div
                              key={group.targetName}
                              className='rounded-md border border-border bg-card px-2.5 py-2'
                            >
                              <h3 className='mb-1 text-xs font-semibold text-foreground'>
                                {group.targetName}
                              </h3>
                              <ul>
                                {group.changes.map(change => (
                                  <AuditChangeRow key={change.id} change={change} />
                                ))}
                              </ul>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {hasMore && accumulatedLogs.length > 0 && (
            <div className='mt-2'>
              <Button
                variant='outline'
                size='sm'
                className='w-full text-xs'
                onClick={handleLoadMore}
                disabled={isPageLoading}
                data-track-category='UserGroups'
                data-track-name='LoadOlderAuditLogs'
              >
                <ChevronDown className='size-4' />
                {isPageLoading ? 'Loading…' : 'Load older changes'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AuditLogSection;
