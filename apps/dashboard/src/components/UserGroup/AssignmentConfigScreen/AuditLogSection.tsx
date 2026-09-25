import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight, History, RefreshCw, Search } from 'lucide-react';
import Avatar from '../../ui/Avatar/Avatar';
import Input from '../../ui/Input/Input';
import { Button } from '../../ui/Button/Button';
import { HoverCard } from '../../ui/HoverCard';
import { cn } from '../../../utils/classNames';
import { fetchAuditLogPage } from '../../../services/auditLogService';
import {
  AuditAction,
  AuditEntityType,
  type AuditLogChange,
  type AuditLogEntry,
} from '@xyne/shared';

interface AuditLogSectionProps {
  entityType: AuditEntityType;
  entityId: string;
  /** Display name of the audited scope (e.g. board name) used in the derived summary line. */
  entityName?: string | undefined;
}

const PAGE_SIZE = 10;

const ENTITY_NOUNS: Record<AuditEntityType, string> = {
  [AuditEntityType.BOARD]: 'board',
  [AuditEntityType.USER_GROUP_ASSIGNMENT_CONFIG]: 'assignment configuration',
};

/** Reconstructs the feed line ("updated board for Payments") from the change rows. */
const deriveSummary = (
  changes: AuditLogChange[],
  entityType: AuditEntityType,
  entityName: string | undefined,
): string => {
  const actions = new Set(changes.map(change => change.action));
  const verb =
    actions.size === 1 && actions.has(AuditAction.CREATE)
      ? 'added'
      : actions.size === 1 && actions.has(AuditAction.DELETE)
        ? 'removed'
        : 'updated';
  const noun = ENTITY_NOUNS[entityType];
  return `${verb} ${noun}${entityName ? ` for ${entityName}` : ''}`;
};

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

const AuditValueText = ({
  value,
  className,
}: {
  value: string;
  className: string;
}): ReactElement => {
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

const AuditChangeRow = ({
  change,
  label,
  bullet,
}: {
  change: AuditLogChange;
  label?: string;
  bullet?: boolean;
}): ReactElement => (
  <li className='flex items-center justify-between gap-3 border-b border-dashed border-border py-1 text-xs last:border-b-0'>
    <span className='flex min-w-0 shrink items-center gap-2 font-medium text-muted-foreground'>
      {bullet && <span className='h-1 w-1 shrink-0 rounded-full bg-muted-foreground/60' />}
      <span className='min-w-0 truncate'>{label ?? humanizeField(change.field)}</span>
    </span>
    <span className='flex min-w-0 max-w-[60%] shrink items-center justify-end gap-1.5 font-mono text-[11px] tabular-nums'>
      {change.action === AuditAction.DELETE ? (
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
          {change.action === AuditAction.UPDATE && (
            <span className='shrink-0 text-muted-foreground/60'>→</span>
          )}
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

/**
 * Deep-diff rows carry the full dot path (e.g. `metadata.ticketFormConfig.todo.enabled`)
 * — 3+ segments — while flat json rows have exactly 2 (`metadata.slaPolicyType`).
 */
const isDeepDiffChange = (change: AuditLogChange): boolean => change.field.split('.').length >= 3;

interface DeepDiffTreeNode {
  groups: Map<string, DeepDiffTreeNode>;
  leaves: AuditLogChange[];
}

/** Bucket deep-diff rows into a tree keyed by their middle path segments. */
const buildDeepDiffTree = (changes: AuditLogChange[]): DeepDiffTreeNode => {
  const root: DeepDiffTreeNode = { groups: new Map(), leaves: [] };
  for (const change of changes) {
    const pathSegments = change.field.split('.').slice(1, -1);
    let node = root;
    for (const segment of pathSegments) {
      let child = node.groups.get(segment);
      if (!child) {
        child = { groups: new Map(), leaves: [] };
        node.groups.set(segment, child);
      }
      node = child;
    }
    node.leaves.push(change);
  }
  return root;
};

const leafLabelOf = (change: AuditLogChange): string => {
  const segments = change.field.split('.');
  return humanizeField(segments[segments.length - 1] ?? change.field);
};

const DeepDiffTreeView = ({
  node,
  depth,
}: {
  node: DeepDiffTreeNode;
  depth: number;
}): ReactElement => (
  <div className='flex flex-col gap-1.5'>
    {node.leaves.length > 0 && (
      <ul>
        {node.leaves.map(change => (
          <AuditChangeRow key={change.id} change={change} bullet label={leafLabelOf(change)} />
        ))}
      </ul>
    )}
    {[...node.groups.entries()].map(([name, child]) => (
      <div key={name} className='flex flex-col gap-1'>
        <p
          className={cn(
            depth === 0
              ? 'mt-1 text-xs font-semibold text-foreground first:mt-0'
              : 'text-[11px] font-medium text-muted-foreground/70',
          )}
        >
          {humanizeField(name)}
        </p>
        <DeepDiffTreeView node={child} depth={depth + 1} />
      </div>
    ))}
  </div>
);

/**
 * A change group's rows: flat two-segment diffs render as plain rows; deep-diff
 * rows render as a nested tree (group heading -> section -> bulleted leaf rows).
 */
const AuditChangeList = ({ changes }: { changes: AuditLogChange[] }): ReactElement => {
  const { flatChanges, deepTree } = useMemo(() => {
    const flat: AuditLogChange[] = [];
    const deep: AuditLogChange[] = [];
    for (const change of changes) {
      (isDeepDiffChange(change) ? deep : flat).push(change);
    }
    return {
      flatChanges: flat,
      deepTree: deep.length > 0 ? buildDeepDiffTree(deep) : null,
    };
  }, [changes]);

  return (
    <div className='flex flex-col gap-1'>
      {flatChanges.length > 0 && (
        <ul>
          {flatChanges.map(change => (
            <AuditChangeRow key={change.id} change={change} />
          ))}
        </ul>
      )}
      {deepTree && <DeepDiffTreeView node={deepTree} depth={0} />}
    </div>
  );
};

export const AuditLogSection = ({
  entityType,
  entityId,
  entityName,
}: AuditLogSectionProps): ReactElement => {
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState<ActionFilter>('all');

  // Sequence guard: a stale response from an earlier entity or an older
  // "load more" call must not overwrite fresher state — last caller wins.
  const requestSeqRef = useRef(0);

  const fetchPage = useCallback(
    async (cursor: string | null, mode: 'replace' | 'append'): Promise<void> => {
      const requestSeq = ++requestSeqRef.current;
      setIsLoading(true);
      setLoadError(false);
      try {
        const page = await fetchAuditLogPage({ entityType, entityId, limit: PAGE_SIZE, cursor });
        if (requestSeq !== requestSeqRef.current) return;
        setLogs(previous => {
          if (mode === 'replace') return page.logs;
          const seenIds = new Set(previous.map(log => log.id));
          return [...previous, ...page.logs.filter(log => !seenIds.has(log.id))];
        });
        setNextCursor(page.nextCursor);
        setHasMore(page.hasMore);
        setHasLoaded(true);
      } catch {
        if (requestSeq !== requestSeqRef.current) return;
        setLoadError(true);
      } finally {
        if (requestSeq === requestSeqRef.current) setIsLoading(false);
      }
    },
    [entityType, entityId],
  );

  // Initial load, and a fresh start whenever the audited entity changes.
  useEffect(() => {
    setLogs([]);
    setExpandedLogIds(new Set());
    setNextCursor(null);
    setHasMore(false);
    void fetchPage(null, 'replace');
  }, [fetchPage]);

  // The refresh affordance fetches the newest first page and replaces the feed.
  const handleRefresh = (): void => {
    if (isLoading) return;
    void fetchPage(null, 'replace');
  };

  const handleLoadMore = (): void => {
    if (!hasMore || isLoading || !nextCursor) return;
    void fetchPage(nextCursor, 'append');
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
      logs.map(log => {
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
        const actorName = log.actor?.name || log.actor?.email || 'System';
        const summaryText = deriveSummary(log.changes, entityType, entityName);
        return {
          log,
          groups,
          summaryText,
          actorName,
          searchText: `${actorName} ${summaryText} ${targetNames.join(' ')}`.toLowerCase(),
        };
      }),
    [logs, entityType, entityName],
  );

  const visibleEntries = useMemo(() => {
    const searchTerm = search.trim().toLowerCase();
    return entries.filter(
      entry =>
        (searchTerm === '' || entry.searchText.includes(searchTerm)) &&
        (actionFilter === 'all' ||
          entry.log.changes.some(change => change.action === AuditAction[actionFilter])),
    );
  }, [entries, search, actionFilter]);

  return (
    <div className='rounded-2xl border border-border bg-card p-4'>
      <div className='mb-3 flex items-start justify-between gap-2'>
        <div>
          <h2 className='text-sm font-semibold text-foreground'>Recent changes</h2>
          <p className='mt-1 text-[13px] leading-[1.4] text-muted-foreground'>
            Every change made to this configuration.
          </p>
        </div>
        <button
          type='button'
          onClick={handleRefresh}
          disabled={isLoading}
          aria-label='Fetch the latest changes'
          className={cn(
            'mt-0.5 flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground transition-colors',
            isLoading ? 'cursor-wait opacity-50' : 'hover:bg-muted hover:text-foreground',
          )}
          data-track-category='AuditTrail'
          data-track-name='RefreshAuditLogs'
        >
          <RefreshCw className={cn('size-3.5', isLoading && 'animate-spin')} />
          Refresh
        </button>
      </div>

      {loadError && logs.length === 0 ? (
        <div className='flex flex-col items-center gap-3 border-t border-border py-8'>
          <p className='text-[13px] text-muted-foreground'>Couldn&apos;t load changes.</p>
          <Button variant='outline' size='sm' onClick={handleRefresh} className='text-xs'>
            <RefreshCw className='size-3.5' />
            Retry
          </Button>
        </div>
      ) : !hasLoaded || (logs.length === 0 && isLoading) ? (
        <div className='flex items-center justify-center gap-2 border-t border-border py-8 text-[13px] text-muted-foreground'>
          <RefreshCw className='size-4 animate-spin text-muted-foreground/60' />
          Loading changes…
        </div>
      ) : logs.length === 0 ? (
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
                data-track-category='AuditTrail'
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
                  data-track-category='AuditTrail'
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
                      data-track-category='AuditTrail'
                      data-track-name='ToggleAuditLogEntry'
                    >
                      <Avatar userId={log.actor?.id ?? null} size='sm' showActiveStatus={false} />
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
                              <AuditChangeList changes={group.changes} />
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

          {hasMore && logs.length > 0 && (
            <div className='mt-2'>
              <Button
                variant='outline'
                size='sm'
                className='w-full text-xs'
                onClick={handleLoadMore}
                disabled={isLoading}
                data-track-category='AuditTrail'
                data-track-name='LoadOlderAuditLogs'
              >
                <ChevronDown className='size-4' />
                {isLoading ? 'Loading…' : 'Load older changes'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default AuditLogSection;
