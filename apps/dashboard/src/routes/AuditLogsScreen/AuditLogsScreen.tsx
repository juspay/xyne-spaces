import { ReactElement, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Check, ChevronDown, Download, Layers, Search } from 'lucide-react';
import { AuditEntityType, type AuditLogEntityOption } from '@xyne/shared';
import { AuditLogSection } from '../../components/UserGroup/AssignmentConfigScreen/AuditLogSection';
import { DeskMetricsDateRangePicker } from '../../components/xyne-desk/DeskMetrics/DeskMetricsDateRangePicker';
import type { DateRangeValue } from '../../components/ui/DateRangeFilter';
import { Button } from '../../components/ui/Button';
import { Popover } from '../../components/ui/Popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { fetchAuditLogEntities, fetchAuditLogExport } from '../../services/auditLogService';
import { downloadAuditLogXlsx } from '../../utils/auditLogExport';
import { showDownloadCompleteToast } from '../../utils/downloadToast';
import { cn } from '../../utils/classNames';

interface AuditSource {
  type: AuditEntityType;
  label: string;
  /** Singular noun for the entity column / export header. */
  entityLabel: string;
  allLabel: string;
  slug: string;
}

const AUDIT_SOURCES: AuditSource[] = [
  {
    type: AuditEntityType.BOARD,
    label: 'Boards',
    entityLabel: 'Board',
    allLabel: 'All boards',
    slug: 'boards',
  },
  {
    type: AuditEntityType.USER_GROUP_ASSIGNMENT_CONFIG,
    label: 'User groups',
    entityLabel: 'User group',
    allLabel: 'All user groups',
    slug: 'user-groups',
  },
  {
    type: AuditEntityType.DESK,
    label: 'Desks',
    entityLabel: 'Desk',
    allLabel: 'All desks',
    slug: 'desks',
  },
];

const DEFAULT_SOURCE = AUDIT_SOURCES[0]!;

/** Matches the picker's "Last 30 days" preset so the trigger shows its label. */
const defaultRange = (): DateRangeValue => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 29);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  return { startDate, endDate };
};

const dateTimeMs = (date: Date, time: string, isEnd: boolean): number => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, isEnd ? 59 : 0, isEnd ? 999 : 0);
  return result.getTime();
};

const AuditEntityPicker = ({
  source,
  entities,
  isLoading,
  selectedId,
  onSelect,
}: {
  source: AuditSource;
  entities: AuditLogEntityOption[];
  isLoading: boolean;
  selectedId: string | null;
  onSelect: (entityId: string | null) => void;
}): ReactElement => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const selected = entities.find(entity => entity.id === selectedId);
  const visible = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term ? entities.filter(entity => entity.name.toLowerCase().includes(term)) : entities;
  }, [entities, query]);

  const choose = (entityId: string | null): void => {
    onSelect(entityId);
    setOpen(false);
    setQuery('');
  };

  const optionClass = (isSelected: boolean): string =>
    cn(
      'flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent',
      isSelected && 'font-medium text-foreground',
    );

  return (
    <Popover
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) setQuery('');
      }}
      align='start'
      sideOffset={6}
      className='p-0'
      trigger={
        <button
          type='button'
          className='flex h-8 w-[220px] items-center gap-1.5 rounded-[8px] border border-border bg-background px-3 text-sm text-foreground hover:bg-accent'
          data-track-category='AuditLogs'
          data-track-name='EntityPickerOpen'
        >
          <Layers size={14} className='shrink-0 text-muted-foreground' />
          <span className='flex-1 truncate text-left'>{selected?.name ?? source.allLabel}</span>
          <ChevronDown size={12} className='shrink-0 text-muted-foreground' />
        </button>
      }
    >
      <div className='w-[280px]'>
        <div className='flex items-center gap-2 border-b border-border px-2 py-1.5'>
          <Search size={14} className='shrink-0 text-muted-foreground' />
          <input
            type='text'
            value={query}
            onChange={event => setQuery(event.target.value)}
            onKeyDown={event => event.stopPropagation()}
            placeholder={`Search ${source.label.toLowerCase()}…`}
            className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
            data-track-category='AuditLogs'
            data-track-name='EntityPickerSearch'
          />
        </div>
        <div
          className='max-h-[300px] overflow-y-auto py-1'
          onWheel={event => event.stopPropagation()}
        >
          {!query.trim() && (
            <button
              type='button'
              onClick={() => choose(null)}
              className={optionClass(selectedId === null)}
              data-track-category='AuditLogs'
              data-track-name='EntityPickerSelectAll'
            >
              <span className='flex-1 truncate'>{source.allLabel}</span>
              {selectedId === null && <Check size={14} className='shrink-0 text-primary' />}
            </button>
          )}
          {isLoading ? (
            <div className='px-3 py-4 text-center text-sm text-muted-foreground'>Loading…</div>
          ) : visible.length === 0 ? (
            <div className='px-3 py-4 text-center text-sm text-muted-foreground'>
              {query.trim() ? 'No matches' : `No ${source.label.toLowerCase()} with changes yet`}
            </div>
          ) : (
            visible.map(entity => (
              <button
                key={entity.id}
                type='button'
                onClick={() => choose(entity.id)}
                className={optionClass(entity.id === selectedId)}
                data-track-category='AuditLogs'
                data-track-name='EntityPickerSelect'
              >
                <span className='flex-1 truncate'>{entity.name}</span>
                {entity.id === selectedId && <Check size={14} className='shrink-0 text-primary' />}
              </button>
            ))
          )}
        </div>
      </div>
    </Popover>
  );
};

/**
 * Workspace-wide audit trail: pick a source (boards / user groups / desks), optionally
 * one entity, and a time window; the feed and the Excel download share those filters.
 */
const AuditLogsScreen = (): ReactElement => {
  const [searchParams, setSearchParams] = useSearchParams();
  const sourceParam = searchParams.get('source');
  const source = AUDIT_SOURCES.find(candidate => candidate.type === sourceParam) ?? DEFAULT_SOURCE;
  const entityId = searchParams.get('entity') || null;

  const [dateRange, setDateRange] = useState<DateRangeValue>(defaultRange);
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const [isExporting, setIsExporting] = useState(false);

  const from = dateTimeMs(dateRange.startDate, startTime, false);
  const to = dateTimeMs(dateRange.endDate, endTime, true);

  const entitiesQuery = useQuery({
    queryKey: ['auditLogEntities', source.type],
    queryFn: () => fetchAuditLogEntities(source.type),
    staleTime: 60_000,
  });
  const entities = useMemo(() => entitiesQuery.data ?? [], [entitiesQuery.data]);
  const selectedEntity = entities.find(entity => entity.id === entityId);

  const updateFilters = (next: { source: AuditEntityType; entity: string | null }): void => {
    const params = new URLSearchParams(searchParams);
    params.set('source', next.source);
    if (next.entity) params.set('entity', next.entity);
    else params.delete('entity');
    setSearchParams(params, { replace: true });
  };

  // A stale ?entity= (no history under this source) falls back to the whole source.
  useEffect(() => {
    if (entityId && entitiesQuery.isSuccess && !entities.some(entity => entity.id === entityId)) {
      const params = new URLSearchParams(searchParams);
      params.delete('entity');
      setSearchParams(params, { replace: true });
    }
  }, [entityId, entities, entitiesQuery.isSuccess, searchParams, setSearchParams]);

  useEffect(() => {
    if (entitiesQuery.isError) toast.error(`Couldn't load ${source.label.toLowerCase()}`);
  }, [entitiesQuery.isError, source.label]);

  const handleDownload = async (): Promise<void> => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const { logs, truncated } = await fetchAuditLogExport({
        entityType: source.type,
        entityId: entityId ?? undefined,
        from,
        to,
      });
      if (logs.length === 0) {
        toast.info('No changes in this period to download');
        return;
      }
      const filename = `audit-logs-${source.slug}-${format(from, 'yyyy-MM-dd')}-to-${format(to, 'yyyy-MM-dd')}.xlsx`;
      await downloadAuditLogXlsx(filename, logs, source.entityLabel);
      showDownloadCompleteToast(filename);
      if (truncated) {
        toast.warning(
          `Only the latest ${logs.length} entries were included. Narrow the date range to export the rest.`,
        );
      }
    } catch {
      toast.error("Couldn't download audit logs");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div
      data-testid='audit-logs-page'
      className='h-full w-full overflow-hidden bg-background shadow-md md:rounded-2xl'
    >
      <div className='flex h-full flex-col'>
        <div className='flex items-center justify-between gap-4 border-b border-border bg-background p-6'>
          <div>
            <h2 className='text-lg font-bold text-foreground'>Audit Logs</h2>
            <p className='mt-1 text-xs text-muted-foreground'>
              Who changed what across boards, user groups and desks.
            </p>
          </div>
          <Button
            variant='outline'
            onClick={() => void handleDownload()}
            disabled={isExporting}
            data-track-category='AuditLogs'
            data-track-name='DownloadXlsx'
            data-track-metadata={JSON.stringify({ source: source.type, scoped: !!entityId })}
          >
            <Download className='size-4' />
            {isExporting ? 'Preparing…' : 'Download Excel'}
          </Button>
        </div>

        <div className='flex flex-wrap items-center gap-3 border-b border-border bg-muted/20 px-6 py-3'>
          <Select
            value={source.type}
            onValueChange={value =>
              updateFilters({ source: value as AuditEntityType, entity: null })
            }
          >
            <SelectTrigger
              className='h-8 w-[160px] text-sm'
              data-track-category='AuditLogs'
              data-track-name='SourceSelect'
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {AUDIT_SOURCES.map(option => (
                <SelectItem key={option.type} value={option.type}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <AuditEntityPicker
            source={source}
            entities={entities}
            isLoading={entitiesQuery.isLoading}
            selectedId={entityId}
            onSelect={entity => updateFilters({ source: source.type, entity })}
          />

          <div className='ml-auto'>
            <DeskMetricsDateRangePicker
              dateRange={dateRange}
              startTime={startTime}
              endTime={endTime}
              trackCategory='AuditLogs'
              onChange={(range, start, end) => {
                setDateRange(range);
                setStartTime(start);
                setEndTime(end);
              }}
            />
          </div>
        </div>

        <div className='min-h-0 flex-1 overflow-y-auto p-6'>
          <div className='mx-auto max-w-4xl'>
            <AuditLogSection
              entityType={source.type}
              entityId={entityId ?? undefined}
              entityName={selectedEntity?.name}
              from={from}
              to={to}
              description={`Changes to ${selectedEntity?.name ?? source.allLabel.toLowerCase()} in the selected period.`}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default AuditLogsScreen;
