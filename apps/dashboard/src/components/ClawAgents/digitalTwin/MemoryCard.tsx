import {
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import {
  AtMark,
  ChatChatting,
  ChatDefault,
  ChevronRight,
  Database,
  File02Default,
  Loader2,
  MoreHorizontal,
  PhoneDefault,
  RefreshCw,
  Trash2,
  UturnLeft,
  type DigitalTwinIcon,
} from './icons';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useClawDigitalTwinPipelineEvent } from '@/hooks/useClawDigitalTwin';
import type { MemoryBankMemory, PipelineRecordPreview } from '@/services/claw/digitalTwinTypes';
import { activitySummary, recordTypeLabel } from './activityLanguage';
import { fmtDate } from './format';
import { normalizeSubsystem, SUBSYSTEM_ICONS, SUBSYSTEM_LABELS } from './subsystems';

interface MemoryKind {
  label: string;
  icon: DigitalTwinIcon;
}

interface EvidenceGroup {
  key: string;
  label: string;
  channelName?: string;
  ts: string;
  icon: DigitalTwinIcon;
  records: PipelineRecordPreview[];
}

const MOTION_EASE = [0.22, 1, 0.36, 1] as const;
const EXPAND_ANCHOR_DURATION_MS = 280;
const COLLAPSE_ANCHOR_DURATION_MS = 220;

const fallbackKind: MemoryKind = {
  label: 'Memory',
  icon: Database,
};

const memoryKind = (memory: MemoryBankMemory): MemoryKind => {
  const subsystemTag = memory.tags?.find(tag => tag.startsWith('subsystem:'))?.slice(10);
  const key = normalizeSubsystem(subsystemTag ?? memory.category ?? '');
  const icon = SUBSYSTEM_ICONS[key];
  const label = SUBSYSTEM_LABELS[key];
  return icon && label ? { icon, label } : fallbackKind;
};

const humanize = (value: string): string =>
  value.replaceAll(/[-_]+/g, ' ').replace(/^\w/, first => first.toUpperCase());

const memoryTitle = (memory: MemoryBankMemory): string => {
  if (memory.title?.trim()) return memory.title.trim();
  const descriptiveTag = memory.tags?.find(tag => !tag.startsWith('subsystem:'));
  if (descriptiveTag) return humanize(descriptiveTag);

  const firstClause = memory.content.split(/[.!?:;]/, 1)[0]?.trim() ?? '';
  const words = firstClause.split(/\s+/).filter(Boolean);
  if (words.length <= 7) return firstClause || 'Untitled memory';
  return `${words.slice(0, 7).join(' ')}…`;
};

const normalizedRecordType = (type: string): string =>
  type
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '-');

const recordIcon = (type: string): DigitalTwinIcon => {
  const normalized = normalizedRecordType(type);
  if (normalized.includes('call')) return PhoneDefault;
  if (normalized.includes('canvas') || normalized.includes('file')) return File02Default;
  if (normalized.includes('mention') && normalized.includes('reply')) return UturnLeft;
  if (normalized.includes('mention')) return AtMark;
  if (normalized.includes('conversation')) return ChatChatting;
  return ChatDefault;
};

const groupEvidence = (records: PipelineRecordPreview[]): EvidenceGroup[] => {
  const groups: EvidenceGroup[] = [];
  const groupIndexes = new Map<string, number>();

  records.forEach(record => {
    const day = Number.isNaN(Date.parse(record.ts)) ? record.ts : record.ts.slice(0, 10);
    const key = [normalizedRecordType(record.type), record.channelName ?? '', day].join('|');
    const existingIndex = groupIndexes.get(key);
    if (existingIndex !== undefined) {
      groups[existingIndex]?.records.push(record);
      return;
    }

    groupIndexes.set(key, groups.length);
    groups.push({
      key,
      label: recordTypeLabel(record.type),
      ...(record.channelName ? { channelName: record.channelName } : {}),
      ts: record.ts,
      icon: recordIcon(record.type),
      records: [record],
    });
  });

  return groups;
};

const scrollContainerFor = (element: HTMLElement): HTMLElement => {
  let current = element.parentElement;

  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    if (/(auto|scroll|overlay)/.test(overflowY) && current.scrollHeight > current.clientHeight) {
      return current;
    }
    current = current.parentElement;
  }

  return (document.scrollingElement as HTMLElement | null) ?? document.documentElement;
};

export const MemoryCard = ({
  memory,
  onDelete,
  recallLabel,
  showTrace = true,
  expansionAnchor = 'top',
}: {
  memory: MemoryBankMemory;
  onDelete?: (hindsightMemoryId: string) => void;
  recallLabel?: string;
  showTrace?: boolean;
  expansionAnchor?: 'top' | 'bottom';
}): ReactElement => {
  const historyId = useId();
  const summaryId = useId();
  const [expanded, setExpanded] = useState(false);
  const [pendingExpand, setPendingExpand] = useState(false);
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [summaryOverflowing, setSummaryOverflowing] = useState(false);
  const reduceMotion = useReducedMotion();
  const summaryRef = useRef<HTMLDivElement>(null);
  const summaryCopyRef = useRef<HTMLParagraphElement>(null);
  const anchorRef = useRef<{ scroller: HTMLElement; top: number } | null>(null);
  const anchorFrameRef = useRef<number | null>(null);
  const evidenceQuery = useClawDigitalTwinPipelineEvent(
    (expanded || pendingExpand) && showTrace && memory.pipelineEventId
      ? memory.pipelineEventId
      : null,
  );
  const kind = memoryKind(memory);
  const KindIcon = kind.icon;
  const evidenceGroups = groupEvidence(evidenceQuery.data?.records ?? []);
  const usageLabel =
    recallLabel ?? `${memory.recallHits7d} use${memory.recallHits7d === 1 ? '' : 's'} this week`;

  useLayoutEffect(() => {
    const summaryCopy = summaryCopyRef.current;
    if (!summaryCopy) return;

    const measureOverflow = (): void => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(summaryCopy).lineHeight);
      setSummaryOverflowing(summaryCopy.scrollHeight > lineHeight * 2 + 1);
    };

    measureOverflow();
    if (typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(measureOverflow);
    observer.observe(summaryCopy);
    return (): void => observer.disconnect();
  }, [memory.content, summaryExpanded]);

  const captureBottomAnchor = useCallback((): void => {
    if (expansionAnchor !== 'bottom') return;
    const summary = summaryRef.current;
    if (!summary) return;

    if (anchorFrameRef.current !== null) cancelAnimationFrame(anchorFrameRef.current);
    anchorRef.current = {
      scroller: scrollContainerFor(summary),
      top: summary.getBoundingClientRect().top,
    };
  }, [expansionAnchor]);

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;

    const startedAt = performance.now();
    const duration = reduceMotion
      ? 0
      : expanded
        ? EXPAND_ANCHOR_DURATION_MS
        : COLLAPSE_ANCHOR_DURATION_MS;

    const keepBottomEdgeFixed = (): void => {
      const summary = summaryRef.current;
      const activeAnchor = anchorRef.current;
      if (!summary || !activeAnchor) return;

      const shift = summary.getBoundingClientRect().top - activeAnchor.top;
      if (Math.abs(shift) > 0.25) activeAnchor.scroller.scrollTop += shift;

      if (performance.now() - startedAt < duration) {
        anchorFrameRef.current = requestAnimationFrame(keepBottomEdgeFixed);
      } else {
        anchorFrameRef.current = null;
        anchorRef.current = null;
      }
    };

    anchorFrameRef.current = requestAnimationFrame(keepBottomEdgeFixed);

    return (): void => {
      if (anchorFrameRef.current !== null) cancelAnimationFrame(anchorFrameRef.current);
      anchorFrameRef.current = null;
    };
  }, [expanded, reduceMotion]);

  useEffect(() => {
    if (!pendingExpand || (!evidenceQuery.data && !evidenceQuery.isError)) return;

    captureBottomAnchor();
    setPendingExpand(false);
    setExpanded(true);
  }, [captureBottomAnchor, evidenceQuery.data, evidenceQuery.isError, pendingExpand]);

  const toggleHistory = (): void => {
    if (pendingExpand) {
      setPendingExpand(false);
      return;
    }

    if (expanded) {
      captureBottomAnchor();
      setExpanded(false);
      return;
    }

    if (memory.pipelineEventId && !evidenceQuery.data && !evidenceQuery.isError) {
      setPendingExpand(true);
      return;
    }

    captureBottomAnchor();
    setExpanded(true);
  };

  const renderHeader = (): ReactElement => (
    <div className='dt-memory-header'>
      <div className='flex min-w-0 items-center gap-2'>
        <span className='inline-flex min-w-0 shrink items-center gap-1.5 truncate text-sm font-medium leading-5 text-foreground'>
          <KindIcon size={16} className='shrink-0' />
          <span className='truncate'>{kind.label}</span>
        </span>
      </div>

      <div className='dt-memory-actions'>
        {expanded && onDelete && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type='button'
                aria-label='Memory actions'
                className='dt-memory-menu'
                data-track-category='Claw Agents'
                data-track-name='Digital Twin open memory actions'
              >
                <MoreHorizontal size={16} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='end' className='min-w-44'>
              <DropdownMenuItem
                className='min-h-10 text-destructive focus:text-destructive'
                onSelect={() => onDelete(memory.hindsightMemoryId)}
                data-track-category='Claw Agents'
                data-track-name='Digital Twin delete memory'
              >
                <Trash2 size={16} />
                Delete memory
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        {showTrace && (
          <motion.button
            type='button'
            onClick={toggleHistory}
            {...(!reduceMotion && { whileTap: { scale: 0.9 } })}
            transition={{ duration: reduceMotion ? 0 : 0.14, ease: MOTION_EASE }}
            aria-expanded={expanded}
            aria-busy={pendingExpand}
            aria-controls={historyId}
            aria-label={
              pendingExpand
                ? 'Cancel loading memory source history'
                : expanded
                  ? 'Close memory source history'
                  : 'Open memory source history'
            }
            className='dt-memory-disclosure'
            data-track-category='Claw Agents'
            data-track-name='Digital Twin memory source history'
          >
            <span className='relative inline-flex size-4' aria-hidden='true'>
              <motion.span
                className='absolute inset-0 inline-flex'
                animate={{ opacity: pendingExpand ? 0 : 1, rotate: expanded ? 90 : -90 }}
                transition={{ duration: reduceMotion ? 0 : 0.18, ease: MOTION_EASE }}
              >
                <ChevronRight size={16} />
              </motion.span>

              {pendingExpand && (
                <motion.span
                  className='absolute inset-0 inline-flex'
                  initial={reduceMotion ? false : { opacity: 0, rotate: 0 }}
                  animate={reduceMotion ? { opacity: 1 } : { opacity: 1, rotate: 360 }}
                  transition={
                    reduceMotion
                      ? { duration: 0 }
                      : {
                          opacity: { duration: 0.1 },
                          rotate: { duration: 0.8, ease: 'linear', repeat: Infinity },
                        }
                  }
                >
                  <Loader2 size={16} />
                </motion.span>
              )}
            </span>
          </motion.button>
        )}
      </div>
    </div>
  );

  return (
    <article
      className={expanded ? 'dt-memory-record dt-memory-record-expanded' : 'dt-memory-record'}
    >
      {renderHeader()}

      {showTrace && (
        <div className='dt-memory-history-reveal' data-expanded={expanded} aria-hidden={!expanded}>
          <div className='dt-memory-history-reveal-inner'>
            <div className='dt-memory-history-scroll'>
              <section
                id={historyId}
                className='dt-memory-history'
                aria-label='Memory source history'
              >
                <div className='dt-memory-why'>
                  <p>
                    {memory.curatorReasoning ??
                      'The source detail did not include a written retention reason.'}
                  </p>
                </div>

                {!memory.pipelineEventId ? (
                  <p className='dt-memory-history-empty'>
                    Source detail was not recorded for this earlier memory. It was approved before
                    learning history was introduced.
                  </p>
                ) : (
                  <>
                    {evidenceQuery.isLoading && (
                      <div className='dt-memory-history-loading'>
                        <Skeleton className='h-4 w-4/5' />
                        <Skeleton className='h-16 w-full rounded-xl' />
                        <Skeleton className='h-16 w-full rounded-xl' />
                      </div>
                    )}

                    {evidenceQuery.isError && (
                      <div role='alert' className='dt-memory-history-error'>
                        <p>Source detail could not be loaded.</p>
                        <Button
                          variant='ghost'
                          size='sm'
                          className='mt-2'
                          onClick={() => void evidenceQuery.refetch()}
                        >
                          <RefreshCw className='size-4' />
                          Try again
                        </Button>
                      </div>
                    )}

                    {evidenceQuery.data && (
                      <>
                        <p className='dt-memory-run-summary'>
                          {activitySummary(evidenceQuery.data)}
                        </p>

                        {evidenceGroups.length > 0 ? (
                          <div className='dt-memory-source-list'>
                            {evidenceGroups.map(group => {
                              const SourceIcon = group.icon;
                              return (
                                <div key={group.key} className='dt-memory-source-group'>
                                  <div className='dt-memory-source-heading'>
                                    <span className='dt-memory-source-icon' aria-hidden='true'>
                                      <SourceIcon size={16} />
                                    </span>
                                    <div className='dt-memory-source-title'>
                                      <span>{group.label}</span>
                                      {group.channelName && (
                                        <span className='dt-memory-source-channel'>
                                          in {group.channelName}
                                        </span>
                                      )}
                                    </div>
                                    <time dateTime={group.ts}>{fmtDate(group.ts)}</time>
                                  </div>

                                  <div className='dt-memory-source-records'>
                                    {group.records.map(record => (
                                      <p key={record.id}>{record.textPreview}</p>
                                    ))}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        ) : (
                          <p className='dt-memory-history-empty'>No source preview was retained.</p>
                        )}
                      </>
                    )}
                  </>
                )}
              </section>
            </div>
          </div>
        </div>
      )}

      <div ref={summaryRef} className='dt-memory-summary'>
        <div className='dt-memory-summary-meta'>
          <h3>{memoryTitle(memory)}</h3>
          <span>
            Added <time dateTime={memory.createdAt}>{fmtDate(memory.createdAt)}</time>
          </span>
          {memory.recallHits7d > 0 && (
            <>
              <span className='dt-memory-dot' aria-hidden='true' />
              <span>{usageLabel}</span>
            </>
          )}
        </div>
        <p
          ref={summaryCopyRef}
          id={summaryId}
          className={
            summaryExpanded ? 'dt-memory-summary-copy' : 'dt-memory-summary-copy line-clamp-2'
          }
        >
          {memory.content}
        </p>
        {summaryOverflowing && (
          <button
            type='button'
            className='dt-memory-summary-toggle'
            aria-expanded={summaryExpanded}
            aria-controls={summaryId}
            onClick={() => setSummaryExpanded(previous => !previous)}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin toggle memory summary'
          >
            {summaryExpanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>
    </article>
  );
};
