import React, { ReactElement, useMemo, useState, useCallback, useRef } from 'react';
import { useActiveUsers } from '../../../hooks/useUsers';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { queries } from '../../../zero/queries';
import {
  RefreshCw,
  X,
  BarChart3,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Download,
  Search,
  UserCircle2,
} from 'lucide-react';
import { Popover } from '../../ui/Popover';
import { type DateRangeValue } from '../../ui/DateRangeFilter';
import { DeskMetricsDateRangePicker } from './DeskMetricsDateRangePicker';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { DeskMetricsTicketRow } from '@xyne/shared';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
import { useDeskMetrics } from '../../../hooks/useDeskMetrics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { showDownloadCompleteToast } from '../../../utils/downloadToast';

export interface DeskMetricsDashboardProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelName?: string;
}

const PRIORITY_COLORS: Record<string, string> = {
  CRITICAL: '#ef4444',
  HIGH: '#f59e0b',
  MEDIUM: '#6366f1',
  LOW: '#10b981',
};

const PRIORITY_BADGE: Record<string, string> = {
  CRITICAL: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  HIGH: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
  MEDIUM: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400',
  LOW: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400',
};

const PAGE_SIZE = 15;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const dateTimeMs = (date: Date, time: string, isEnd: boolean): number => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, isEnd ? 59 : 0, isEnd ? 999 : 0);
  return result.getTime();
};

const defaultDateRange = (): DateRangeValue => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 6);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { startDate: start, endDate: end };
};

export const formatDuration = (seconds: number | null): string => {
  if (seconds === null || !Number.isFinite(seconds)) return '—';
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s}s`;
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

const priorityLabel = (p: string): string =>
  p.charAt(0) + p.slice(1).toLowerCase().replace(/_/g, ' ');

const formatTrendLabel = (bucketStartMs: number, hourly: boolean): string => {
  const date = new Date(bucketStartMs);
  if (hourly) {
    return date.toLocaleTimeString('en-US', { hour: 'numeric' }).replace(/\s/g, '').toLowerCase();
  }
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};

const getCustomFieldKeys = (tickets: DeskMetricsTicketRow[]): string[] =>
  [...new Set(tickets.flatMap(t => Object.keys(t.customFields ?? {})))].sort();

const downloadCsv = (tickets: DeskMetricsTicketRow[]): string => {
  const filename = 'desk-metrics.csv';
  const customKeys = getCustomFieldKeys(tickets);
  const headers = [
    'ID',
    'Title',
    'Assignee',
    'Priority',
    'Stage',
    'Status',
    'FRT',
    'RT',
    'CSAT',
    ...customKeys,
  ];
  const rows = tickets.map(t => [
    t.xyneId ?? t.ticketId.slice(0, 8),
    `"${(t.title ?? '').replace(/"/g, '""')}"`,
    `"${(t.assigneeName ?? 'Unassigned').replace(/"/g, '""')}"`,
    t.priority,
    `"${(t.stageName ?? '—').replace(/"/g, '""')}"`,
    t.statusV2,
    formatDuration(t.frtSeconds),
    formatDuration(t.rtSeconds),
    t.csatScore !== null ? `${t.csatScore.toFixed(1)}/5` : (t.csatRating ?? '—'),
    ...customKeys.map(k => `"${(t.customFields?.[k] ?? '').replace(/"/g, '""')}"`),
  ]);
  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return filename;
};

const MetricsTicketTable = ({
  tickets,
  onDownload,
}: {
  tickets: DeskMetricsTicketRow[];
  onDownload: () => void;
}): ReactElement => {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(tickets.length / PAGE_SIZE);
  const pageRows = tickets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const customFieldKeys = useMemo(() => getCustomFieldKeys(tickets), [tickets]);

  return (
    <div className='rounded-[12px] border border-desk-border bg-background dark:border-border'>
      <div className='flex items-center justify-between border-b border-desk-border px-4 py-3 dark:border-border'>
        <span className='text-sm font-medium text-foreground'>Tickets ({tickets.length})</span>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={onDownload}
            className='flex items-center gap-1 rounded-[8px] border border-desk-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground dark:border-border'
            data-track-category='DeskMetrics'
            data-track-name='DownloadCsv'
          >
            <Download size={12} />
            CSV
          </button>
          {totalPages > 1 && (
            <div className='flex items-center gap-1 text-xs text-muted-foreground'>
              <button
                type='button'
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={page === 0}
                className='flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-40'
                data-track-category='DeskMetrics'
                data-track-name='TicketTablePrev'
              >
                <ChevronLeft size={14} />
              </button>
              <span>
                {page + 1} / {totalPages}
              </span>
              <button
                type='button'
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className='flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-40'
                data-track-category='DeskMetrics'
                data-track-name='TicketTableNext'
              >
                <ChevronRight size={14} />
              </button>
            </div>
          )}
        </div>
      </div>
      <div className='overflow-x-auto'>
        <table className='w-full text-sm'>
          <thead>
            <tr className='border-b border-desk-border/60 text-left dark:border-border/60'>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                ID
              </th>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Title
              </th>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Assignee
              </th>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Priority
              </th>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Stage
              </th>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                FRT
              </th>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                RT
              </th>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                CSAT
              </th>
              {customFieldKeys.length > 0 && (
                <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                  Custom Fields
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => (
              <tr
                key={row.ticketId}
                className={cn(
                  'border-b border-desk-border/40 last:border-b-0 dark:border-border/40',
                  i % 2 !== 0 && 'bg-muted/20',
                )}
              >
                <td className='px-4 py-2 font-mono text-xs text-muted-foreground'>
                  {row.xyneId ?? row.ticketId.slice(0, 8)}
                </td>
                <td className='max-w-[200px] truncate px-4 py-2 text-foreground'>
                  {row.title ?? '—'}
                </td>
                <td className='max-w-[140px] truncate px-4 py-2 text-xs text-muted-foreground'>
                  {row.assigneeName ?? 'Unassigned'}
                </td>
                <td className='px-4 py-2'>
                  <span
                    className={cn(
                      'rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium',
                      PRIORITY_BADGE[row.priority] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {priorityLabel(row.priority)}
                  </span>
                </td>
                <td className='px-4 py-2 text-xs text-muted-foreground'>{row.stageName ?? '—'}</td>
                <td className='px-4 py-2 font-mono text-xs'>{formatDuration(row.frtSeconds)}</td>
                <td className='px-4 py-2 font-mono text-xs'>{formatDuration(row.rtSeconds)}</td>
                <td className='px-4 py-2 text-xs'>
                  {row.csatScore !== null
                    ? `${row.csatScore.toFixed(1)}/5`
                    : (row.csatRating ?? '—')}
                </td>
                {customFieldKeys.length > 0 && (
                  <td className='px-4 py-2'>
                    {row.customFields && Object.keys(row.customFields).length > 0 ? (
                      <Popover
                        side='left'
                        align='start'
                        sideOffset={8}
                        trigger={
                          <button
                            type='button'
                            className='inline-flex items-center gap-1 rounded-[6px] border border-desk-border bg-muted/50 px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground dark:border-border'
                          >
                            {Object.keys(row.customFields).length} fields
                            <ChevronDown size={10} />
                          </button>
                        }
                        className='p-0'
                      >
                        <div className='min-w-[180px] max-w-[320px]'>
                          <div className='border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                            Custom Fields
                          </div>
                          <div
                            className='max-h-48 overflow-y-auto'
                            onWheel={e => e.stopPropagation()}
                          >
                            {Object.entries(row.customFields).map(([key, val]) => (
                              <div
                                key={key}
                                className='flex items-start gap-2 px-3 py-1.5 text-xs odd:bg-muted/30'
                              >
                                <span className='w-24 shrink-0 font-medium text-foreground'>
                                  {key}
                                </span>
                                <span className='min-w-0 break-words text-muted-foreground'>
                                  {val || '—'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      </Popover>
                    ) : (
                      <span className='text-xs text-muted-foreground'>—</span>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

const KpiCard = ({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}): ReactElement => (
  <div className='flex flex-col gap-1 rounded-[12px] border border-desk-border bg-background p-4 dark:border-border'>
    <div className='text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground'>
      {label}
    </div>
    <div className='font-mono text-2xl font-semibold leading-none tabular-nums text-foreground'>
      {value}
    </div>
    {sub && <div className='text-xs text-muted-foreground'>{sub}</div>}
  </div>
);

export const DeskMetricsDashboard: React.FC<DeskMetricsDashboardProps> = ({
  open,
  onClose,
  channelId,
  channelName,
}) => {
  const [dateRange, setDateRange] = useState<DateRangeValue>(defaultDateRange);
  const [startTime, setStartTime] = useState('00:00');
  const [endTime, setEndTime] = useState('23:59');
  const rangeStartMs = dateTimeMs(dateRange.startDate, startTime, false);
  const rangeEndMs = dateTimeMs(dateRange.endDate, endTime, true);
  const timeRangeParam = `${rangeStartMs}_${rangeEndMs}`;
  const isHourly = rangeEndMs - rangeStartMs <= DAY_MS;
  const [selectedAssigneeId, setSelectedAssigneeId] = useState<string | null>(null);
  const [ownerSearch, setOwnerSearch] = useState('');
  const ownerSearchInputRef = useRef<HTMLInputElement>(null);

  const activeUsers = useActiveUsers();
  const [participants] = useCachedQuery(queries.channelParticipants({ channelId }), {
    enabled: open,
  });

  const { data, isLoading, isFetching, isError, refetch } = useDeskMetrics(
    channelId,
    timeRangeParam,
    open,
    selectedAssigneeId,
  );

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) onClose();
  };

  const channelAssignees = useMemo(() => {
    const memberIds = new Set((participants ?? []).map(p => p.userId));
    const members = (activeUsers ?? [])
      .filter(u => memberIds.has(u.id))
      .map(u => ({ id: u.id, name: u.displayName ?? u.name ?? u.email ?? u.id }));
    const q = ownerSearch.trim().toLowerCase();
    return q ? members.filter(a => a.name.toLowerCase().includes(q)) : members;
  }, [participants, activeUsers, ownerSearch]);

  const priorityData = (data?.priority ?? []).map(p => ({
    name: priorityLabel(p.priority),
    value: p.count,
    color: PRIORITY_COLORS[p.priority] ?? '#94a3b8',
  }));

  const trendData = useMemo(
    () =>
      (data?.trend ?? []).map((d, index) => ({
        ...d,
        label: formatTrendLabel(rangeStartMs + index * (isHourly ? HOUR_MS : DAY_MS), isHourly),
      })),
    [data?.trend, isHourly, rangeStartMs],
  );

  const tickInterval = useMemo(() => {
    const n = trendData.length;
    if (n <= 8) return 0;
    if (n <= 31) return 4;
    return Math.floor(n / 6);
  }, [trendData.length]);

  const csatTotal = (data?.csat.good ?? 0) + (data?.csat.bad ?? 0);
  const isEmpty = !!data && data.tickets.length === 0 && data.counts.stageCounts.length === 0;

  const handleDownload = useCallback(() => {
    if (!data?.tickets) return;
    const filename = downloadCsv(data.tickets);
    showDownloadCompleteToast(filename);
  }, [data?.tickets]);

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title='Desk Metrics'
      className='max-w-[95vw] w-[1400px] max-h-[95vh] bg-transparent shadow-none rounded-none'
    >
      <div>
        <div className='isolate flex h-[92vh] max-h-[92vh] flex-col overflow-hidden rounded-[12px] border border-desk-border bg-popover shadow-lg dark:border-border'>
          {/* Header */}
          <div className='flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-desk-border px-6 py-4 dark:border-border'>
            <div className='flex items-center gap-2'>
              <BarChart3 size={18} className='text-desk-accent' />
              <span className='text-base font-semibold text-foreground'>
                {channelName ? `${channelName} — Metrics` : 'Desk Metrics'}
              </span>
            </div>
            <div className='flex items-center gap-3'>
              {/* Assignee filter */}
              <Select
                value={selectedAssigneeId ?? '__all__'}
                onValueChange={v => setSelectedAssigneeId(v === '__all__' ? null : v)}
                onOpenChange={open => {
                  if (!open) setOwnerSearch('');
                }}
              >
                <SelectTrigger
                  className='h-[32px] min-w-[140px] rounded-[8px] border border-desk-border bg-background px-3 text-sm text-foreground shadow-none dark:border-border'
                  data-track-category='DeskMetrics'
                  data-track-name='AssigneeFilter'
                >
                  <div className='flex items-center gap-1.5'>
                    <UserCircle2 size={14} className='shrink-0 text-muted-foreground' />
                    <SelectValue placeholder='All assignees' />
                  </div>
                </SelectTrigger>
                <SelectContent
                  className='rounded-[10px]'
                  header={
                    <div className='flex items-center gap-2 border-b border-border bg-popover px-2 py-1.5'>
                      <Search size={14} className='shrink-0 text-muted-foreground' />
                      <input
                        ref={ownerSearchInputRef}
                        type='text'
                        value={ownerSearch}
                        onChange={e => {
                          setOwnerSearch(e.target.value);
                          requestAnimationFrame(() => ownerSearchInputRef.current?.focus());
                        }}
                        onKeyDown={e => e.stopPropagation()}
                        onPointerDown={e => e.stopPropagation()}
                        placeholder='Search assignees…'
                        autoFocus
                        className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                        data-track-category='DeskMetrics'
                        data-track-name='SearchAssignees'
                      />
                    </div>
                  }
                >
                  {!ownerSearch && (
                    <SelectItem value='__all__' className='rounded-[8px]'>
                      <span className='text-sm'>All assignees</span>
                    </SelectItem>
                  )}
                  {channelAssignees.map(u => (
                    <SelectItem key={u.id} value={u.id} className='rounded-[8px]'>
                      <span>{u.name}</span>
                    </SelectItem>
                  ))}
                  {channelAssignees.length === 0 && (
                    <div className='px-3 py-4 text-center text-sm text-muted-foreground'>
                      {selectedAssigneeId ? 'Loading…' : 'No assignees in this period'}
                    </div>
                  )}
                </SelectContent>
              </Select>

              <DeskMetricsDateRangePicker
                dateRange={dateRange}
                startTime={startTime}
                endTime={endTime}
                onChange={(dr, st, et) => {
                  setDateRange(dr);
                  setStartTime(st);
                  setEndTime(et);
                }}
              />

              <button
                type='button'
                onClick={() => void refetch()}
                disabled={isFetching}
                className={cn(
                  'rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground',
                  isFetching && 'cursor-not-allowed opacity-60',
                )}
                title='Refresh metrics'
                data-track-category='DeskMetrics'
                data-track-name='Refresh'
              >
                <RefreshCw size={16} className={cn(isFetching && 'animate-spin')} />
              </button>

              {/* Close button */}
              <button
                type='button'
                onClick={onClose}
                className='flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-desk-border bg-background text-muted-foreground transition-colors hover:bg-accent hover:text-foreground dark:border-border'
                data-track-category='DeskMetrics'
                data-track-name='CloseButton'
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Body */}
          <div className='min-h-0 flex-1 overflow-y-auto p-6'>
            {isLoading ? (
              <div className='flex animate-pulse flex-col gap-4'>
                <div className='grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6'>
                  {Array.from({ length: 6 }).map((_, i) => (
                    <div key={i} className='h-20 rounded-[12px] bg-muted/60' />
                  ))}
                </div>
                <div className='grid grid-cols-1 gap-3 lg:grid-cols-2'>
                  <div className='h-[200px] rounded-[12px] bg-muted/60' />
                  <div className='h-[200px] rounded-[12px] bg-muted/60' />
                </div>
                <div className='h-[400px] rounded-[12px] bg-muted/60' />
              </div>
            ) : isError ? (
              <div className='flex h-full flex-col items-center justify-center gap-2 text-center'>
                <AlertCircle size={28} className='text-red-500' />
                <p className='text-sm font-medium text-foreground'>Failed to load metrics</p>
                <p className='text-xs text-muted-foreground'>
                  Metrics may not be enabled for this desk, or something went wrong.
                </p>
                <button
                  type='button'
                  onClick={() => void refetch()}
                  className='mt-2 rounded-[10px] border border-desk-accent bg-desk-accent px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:opacity-90'
                  data-track-category='DeskMetrics'
                  data-track-name='Retry'
                >
                  Retry
                </button>
              </div>
            ) : !data ? null : (
              <div className='flex flex-col gap-4'>
                {/* KPI row — FRT / RT / CSAT / Email Replies */}
                <div className='grid grid-cols-2 gap-3 md:grid-cols-4'>
                  <KpiCard
                    label='Avg First Response'
                    value={formatDuration(data.frt.avgSeconds)}
                    sub={`${data.frt.respondedTickets} responded`}
                  />
                  <KpiCard
                    label='Avg Resolution'
                    value={formatDuration(data.rt.avgSeconds)}
                    sub={`${data.rt.resolvedTickets} resolved`}
                  />
                  <KpiCard
                    label='CSAT'
                    value={data.csat.avgScore !== null ? `${data.csat.avgScore.toFixed(1)}/5` : '—'}
                    sub={
                      csatTotal > 0
                        ? `${data.csat.good} good · ${data.csat.bad} bad`
                        : 'No responses'
                    }
                  />
                  <KpiCard label='Email Replies' value={String(data.counts.emailRepliesInRange)} />
                </div>

                {/* Stage counts */}
                {data.counts.stageCounts.length > 0 && (
                  <div className='flex flex-col gap-2 rounded-[12px] border border-desk-border bg-background p-4 dark:border-border'>
                    <div className='text-sm font-medium text-foreground'>Tickets by stage</div>
                    <div className='flex flex-wrap gap-2'>
                      {data.counts.stageCounts.map(s => (
                        <div
                          key={s.stageName}
                          className='flex items-center gap-2 rounded-[8px] border border-desk-border/60 bg-muted/30 px-3 py-1.5 dark:border-border/60'
                        >
                          <span className='text-xs text-muted-foreground'>{s.stageName}</span>
                          <span className='font-mono text-sm font-semibold tabular-nums text-foreground'>
                            {s.count}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {isEmpty ? (
                  <div className='flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-desk-border py-16 text-center dark:border-border'>
                    <BarChart3 size={28} className='text-muted-foreground/70' />
                    <p className='text-sm font-medium text-foreground'>
                      No activity in this time range
                    </p>
                    <p className='max-w-[420px] text-xs text-muted-foreground'>
                      Metrics are collected from when desk metrics were enabled for this desk.
                    </p>
                  </div>
                ) : (
                  <>
                    {/* Charts row */}
                    <div className='grid grid-cols-1 gap-4 lg:grid-cols-2'>
                      <div className='flex flex-col rounded-[12px] border border-desk-border bg-background p-4 dark:border-border'>
                        <div className='mb-2 text-sm font-medium text-foreground'>
                          Tickets by priority
                        </div>
                        {priorityData.length === 0 ? (
                          <div className='flex h-[200px] items-center justify-center text-xs text-muted-foreground'>
                            No tickets in range
                          </div>
                        ) : (
                          <div className='h-[200px]'>
                            <ResponsiveContainer width='100%' height='100%'>
                              <PieChart>
                                <Pie
                                  data={priorityData}
                                  dataKey='value'
                                  nameKey='name'
                                  innerRadius={55}
                                  outerRadius={80}
                                  paddingAngle={3}
                                >
                                  {priorityData.map(entry => (
                                    <Cell key={entry.name} fill={entry.color} />
                                  ))}
                                </Pie>
                                <RechartsTooltip />
                                <Legend />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                      <div className='flex flex-col rounded-[12px] border border-desk-border bg-background p-4 dark:border-border'>
                        <div className='mb-2 text-sm font-medium text-foreground'>
                          Tickets created vs resolved {isHourly ? '(hourly)' : '(daily)'}
                        </div>
                        {trendData.length === 0 ? (
                          <div className='flex h-[200px] items-center justify-center text-xs text-muted-foreground'>
                            No data in range
                          </div>
                        ) : (
                          <div className='h-[200px]'>
                            <ResponsiveContainer width='100%' height='100%'>
                              <BarChart data={trendData} margin={{ left: -16, right: 4 }}>
                                <CartesianGrid strokeDasharray='3 3' vertical={false} />
                                <XAxis
                                  dataKey='label'
                                  tick={{ fontSize: 11 }}
                                  interval={tickInterval}
                                />
                                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                                <RechartsTooltip />
                                <Legend />
                                <Bar
                                  dataKey='opened'
                                  name='Created'
                                  fill='#6366f1'
                                  radius={[4, 4, 0, 0]}
                                />
                                <Bar
                                  dataKey='closed'
                                  name='Resolved'
                                  fill='#10b981'
                                  radius={[4, 4, 0, 0]}
                                />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Ticket table */}
                    {data.tickets.length > 0 && (
                      <MetricsTicketTable tickets={data.tickets} onDownload={handleDownload} />
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </Dialog>
  );
};
