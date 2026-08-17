import React, { ReactElement, useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { useActiveUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { usePersistedDeskMetricsFilters } from '../../../hooks/usePersistedDeskMetricsFilters';
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
  ChevronUp,
  ArrowUpDown,
  Download,
  Search,
  UserCircle2,
  Users,
  SlidersHorizontal,
  Maximize2,
  Layers,
} from 'lucide-react';
import { Popover } from '../../ui/Popover';
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
import {
  DESK_METRICS_MAX_AGGREGATE_DESKS,
  type DeskMetricsAgentRow,
  type DeskMetricsPerDeskRow,
  type DeskMetricsSkippedDesk,
  type DeskMetricsTicketRow,
} from '@xyne/shared';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
import { useAggregateDeskMetrics } from '../../../hooks/useDeskMetrics';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../ui/Select/Select';
import { showDownloadCompleteToast } from '../../../utils/downloadToast';
import { CHART_COLORS as VIZ_CHART_COLORS } from '../../QueryVisualizations/constants';

export interface DeskMetricsSelectableDesk {
  id: string;
  name: string;
}

export interface DeskMetricsDashboardProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelName?: string;
  availableDesks?: DeskMetricsSelectableDesk[];
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
const DAY_MS = 24 * 60 * 60 * 1000;

const dateTimeMs = (date: Date, time: string, isEnd: boolean): number => {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const result = new Date(date);
  result.setHours(hour, minute, isEnd ? 59 : 0, isEnd ? 999 : 0);
  return result.getTime();
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

// Whole days since creation, shared by the ticket table and its CSV export so
// the two never drift.
const ageInDays = (createdAtMs: number): number =>
  Math.max(0, Math.floor((Date.now() - createdAtMs) / DAY_MS));

const priorityLabel = (p: string): string =>
  p.charAt(0) + p.slice(1).toLowerCase().replace(/_/g, ' ');

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
    'Created At',
    'Age',
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
    `"${new Date(t.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}"`,
    `${ageInDays(t.createdAt)}d`,
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

const agentDisplayName = (row: DeskMetricsAgentRow): string => row.assigneeName ?? 'Unassigned';

const resolvedRate = (row: DeskMetricsAgentRow): number | null =>
  row.assigned > 0 ? row.resolved / row.assigned : null;

const getAgentStageCount = (row: DeskMetricsAgentRow, stageName: string): number =>
  row.stageCounts
    .filter(stage => stage.stageName.trim().toLowerCase() === stageName.trim().toLowerCase())
    .reduce((total, stage) => total + stage.count, 0);

const getAgentStageNames = (agents: DeskMetricsAgentRow[]): string[] => {
  const totals = new Map<string, { stageName: string; count: number }>();
  for (const agent of agents) {
    for (const stage of agent.stageCounts) {
      const stageName = stage.stageName.trim() || 'Unassigned';
      const key = stageName.toLowerCase();
      const existing = totals.get(key);
      totals.set(key, {
        stageName: existing?.stageName ?? stageName,
        count: (existing?.count ?? 0) + stage.count,
      });
    }
  }
  return [...totals.values()]
    .sort((a, b) => b.count - a.count || a.stageName.localeCompare(b.stageName))
    .map(({ stageName }) => stageName);
};

const downloadAgentCsv = (agents: DeskMetricsAgentRow[]): string => {
  const filename = 'desk-metrics-agents.csv';
  const stageNames = getAgentStageNames(agents);
  const headers = [
    'Agent',
    'Assigned',
    ...stageNames.map(stageName => `Stage: ${stageName}`),
    'Responded',
    'Resolved',
    'Reopened',
    'Resolved %',
    'Avg FRT',
    'Avg RT',
    'CSAT',
    'CSAT Good',
    'CSAT Bad',
    'Replies Sent',
  ];
  const rows = agents.map(a => {
    const rate = resolvedRate(a);
    return [
      `"${agentDisplayName(a).replace(/"/g, '""')}"`,
      a.assigned,
      ...stageNames.map(stageName => getAgentStageCount(a, stageName)),
      a.responded,
      a.resolved,
      a.reopened,
      rate !== null ? `${Math.round(rate * 100)}%` : '',
      formatDuration(a.avgFrtSeconds),
      formatDuration(a.avgRtSeconds),
      a.csatAvgScore !== null ? a.csatAvgScore.toFixed(1) : '',
      a.csatGood,
      a.csatBad,
      a.emailReplies,
    ];
  });
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

type AgentMetricSortKey =
  | 'assigned'
  | 'responded'
  | 'resolved'
  | 'reopened'
  | 'avgFrtSeconds'
  | 'avgRtSeconds'
  | 'csatAvgScore'
  | 'emailReplies';

type AgentSortKey = 'assigneeName' | AgentMetricSortKey | 'resolvedRate' | `stage:${string}`;

const AGENT_COLUMNS: Array<{
  key: AgentSortKey;
  label: string;
  numeric: boolean;
  title?: string;
}> = [
  { key: 'assigneeName', label: 'Agent', numeric: false },
  {
    key: 'assigned',
    label: 'Assigned',
    numeric: true,
    title: 'Tickets created in this range that are currently assigned to this agent',
  },
  {
    key: 'responded',
    label: 'Responded',
    numeric: true,
    title: 'Assigned tickets with a recorded first response',
  },
  {
    key: 'resolved',
    label: 'Resolved',
    numeric: true,
    title: 'Of those, how many reached a resolved stage',
  },
  {
    key: 'reopened',
    label: 'Reopened',
    numeric: true,
    title: 'Distinct assigned tickets reopened at least once within this range',
  },
  { key: 'resolvedRate', label: 'Resolved %', numeric: true },
  { key: 'avgFrtSeconds', label: 'Avg FRT', numeric: true, title: 'Average first response time' },
  { key: 'avgRtSeconds', label: 'Avg RT', numeric: true, title: 'Average resolution time' },
  { key: 'csatAvgScore', label: 'CSAT', numeric: true },
  {
    key: 'emailReplies',
    label: 'Replies Sent',
    numeric: true,
    title: 'Replies this agent personally sent in this range, including on tickets they do not own',
  },
];

const agentSortValue = (row: DeskMetricsAgentRow, key: AgentSortKey): string | number | null => {
  if (key === 'assigneeName') return agentDisplayName(row);
  if (key === 'resolvedRate') return resolvedRate(row);
  if (key.startsWith('stage:')) return getAgentStageCount(row, key.slice('stage:'.length));
  return row[key as AgentMetricSortKey];
};

const MetricsAgentTable = ({
  agents,
  onDownload,
}: {
  agents: DeskMetricsAgentRow[];
  onDownload: () => void;
}): ReactElement => {
  const [sortKey, setSortKey] = useState<AgentSortKey>('assigned');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(0);

  const stageNames = useMemo(() => getAgentStageNames(agents), [agents]);
  const agentColumns = useMemo(
    () => [
      ...AGENT_COLUMNS.slice(0, 2),
      ...stageNames.map(stageName => ({
        key: `stage:${stageName}` as AgentSortKey,
        label: stageName,
        numeric: true,
        title: `Tickets currently in the ${stageName} stage`,
      })),
      ...AGENT_COLUMNS.slice(2),
    ],
    [stageNames],
  );

  const sorted = useMemo(() => {
    const rows = [...agents];
    rows.sort((a, b) => {
      const av = agentSortValue(a, sortKey);
      const bv = agentSortValue(b, sortKey);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      const cmp =
        typeof av === 'string' && typeof bv === 'string'
          ? av.localeCompare(bv)
          : Number(av) - Number(bv);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [agents, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = sorted.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE);

  const toggleSort = (key: AgentSortKey): void => {
    if (key === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'assigneeName' ? 'asc' : 'desc');
    }
    setPage(0);
  };

  return (
    <div className='rounded-[12px] border border-desk-border bg-background dark:border-border'>
      <div className='flex items-center justify-between border-b border-desk-border px-4 py-3 dark:border-border'>
        <span className='text-sm font-medium text-foreground'>Agents ({agents.length})</span>
        <div className='flex items-center gap-2'>
          <button
            type='button'
            onClick={onDownload}
            className='flex items-center gap-1 rounded-[8px] border border-desk-border px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground dark:border-border'
            data-track-category='DeskMetrics'
            data-track-name='DownloadAgentCsv'
          >
            <Download size={12} />
            CSV
          </button>
          {totalPages > 1 && (
            <div className='flex items-center gap-1 text-xs text-muted-foreground'>
              <button
                type='button'
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={safePage === 0}
                className='flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-40'
                data-track-category='DeskMetrics'
                data-track-name='AgentTablePrev'
              >
                <ChevronLeft size={14} />
              </button>
              <span>
                {safePage + 1} / {totalPages}
              </span>
              <button
                type='button'
                onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                disabled={safePage === totalPages - 1}
                className='flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-40'
                data-track-category='DeskMetrics'
                data-track-name='AgentTableNext'
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
              {agentColumns.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    'px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground',
                    col.numeric && 'text-right',
                  )}
                  title={col.title}
                >
                  <button
                    type='button'
                    onClick={() => toggleSort(col.key)}
                    className={cn(
                      'inline-flex items-center gap-1 uppercase transition-colors hover:text-foreground',
                      sortKey === col.key && 'text-foreground',
                    )}
                    data-track-category='DeskMetrics'
                    data-track-name='SortAgentTable'
                  >
                    {col.label}
                    {sortKey === col.key ? (
                      sortDir === 'asc' ? (
                        <ChevronUp size={12} />
                      ) : (
                        <ChevronDown size={12} />
                      )
                    ) : (
                      <ArrowUpDown size={11} className='opacity-40' />
                    )}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row, i) => {
              const rate = resolvedRate(row);
              return (
                <tr
                  key={row.assigneeId ?? '__unassigned__'}
                  className={cn(
                    'border-b border-desk-border/40 last:border-b-0 dark:border-border/40',
                    i % 2 !== 0 && 'bg-muted/20',
                  )}
                >
                  <td className='px-4 py-2 text-foreground'>
                    <div className='flex items-center gap-2'>
                      <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-[10px] font-semibold uppercase text-muted-foreground'>
                        {agentDisplayName(row).slice(0, 2)}
                      </span>
                      <span className='max-w-[180px] truncate' title={agentDisplayName(row)}>
                        {agentDisplayName(row)}
                      </span>
                    </div>
                  </td>
                  <td className='whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-foreground'>
                    {row.assigned}
                  </td>
                  {stageNames.map(stageName => (
                    <td
                      key={stageName}
                      className='whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-foreground'
                    >
                      {getAgentStageCount(row, stageName)}
                    </td>
                  ))}
                  <td className='whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-foreground'>
                    {row.responded}
                  </td>
                  <td className='whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-foreground'>
                    {row.resolved}
                  </td>
                  <td className='whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-foreground'>
                    {row.reopened}
                  </td>
                  <td className='whitespace-nowrap px-4 py-2 text-right'>
                    {rate === null ? (
                      <span className='font-mono text-xs text-muted-foreground'>—</span>
                    ) : (
                      <div className='flex items-center justify-end gap-2'>
                        <div className='h-1.5 w-14 overflow-hidden rounded-full bg-muted'>
                          <div
                            className='h-full rounded-full bg-emerald-500'
                            style={{ width: `${Math.round(rate * 100)}%` }}
                          />
                        </div>
                        <span className='w-9 font-mono text-xs tabular-nums text-muted-foreground'>
                          {Math.round(rate * 100)}%
                        </span>
                      </div>
                    )}
                  </td>
                  <td className='whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums'>
                    {formatDuration(row.avgFrtSeconds)}
                  </td>
                  <td className='whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums'>
                    {formatDuration(row.avgRtSeconds)}
                  </td>
                  <td className='whitespace-nowrap px-4 py-2 text-right text-xs'>
                    {row.csatAvgScore !== null ? (
                      <span className='text-foreground'>{row.csatAvgScore.toFixed(1)}/5</span>
                    ) : (
                      <span className='text-muted-foreground'>—</span>
                    )}
                    {row.csatGood + row.csatBad > 0 && (
                      <span className='ml-1 text-[11px] text-muted-foreground'>
                        ({row.csatGood}↑ {row.csatBad}↓)
                      </span>
                    )}
                  </td>
                  <td className='whitespace-nowrap px-4 py-2 text-right font-mono text-xs tabular-nums text-foreground'>
                    {row.emailReplies}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
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
              {customFieldKeys.map(key => (
                <th
                  key={key}
                  className='whitespace-nowrap px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'
                >
                  {key}
                </th>
              ))}
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Created At
              </th>
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Age
              </th>
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
                <td className='whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground'>
                  {row.xyneId ?? row.ticketId.slice(0, 8)}
                </td>
                <td className='px-4 py-2 text-foreground'>
                  <div className='max-w-[200px] truncate'>{row.title ?? '—'}</div>
                </td>
                <td className='px-4 py-2 text-xs text-muted-foreground'>
                  <div className='max-w-[140px] truncate'>{row.assigneeName ?? 'Unassigned'}</div>
                </td>
                <td className='whitespace-nowrap px-4 py-2'>
                  <span
                    className={cn(
                      'rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium',
                      PRIORITY_BADGE[row.priority] ?? 'bg-muted text-muted-foreground',
                    )}
                  >
                    {priorityLabel(row.priority)}
                  </span>
                </td>
                <td className='whitespace-nowrap px-4 py-2 text-xs text-muted-foreground'>
                  {row.stageName ?? '—'}
                </td>
                <td className='whitespace-nowrap px-4 py-2 font-mono text-xs'>
                  {formatDuration(row.frtSeconds)}
                </td>
                <td className='whitespace-nowrap px-4 py-2 font-mono text-xs'>
                  {formatDuration(row.rtSeconds)}
                </td>
                <td className='whitespace-nowrap px-4 py-2 text-xs'>
                  {row.csatScore !== null
                    ? `${row.csatScore.toFixed(1)}/5`
                    : (row.csatRating ?? '—')}
                </td>
                {customFieldKeys.map(key => (
                  <td
                    key={key}
                    className='whitespace-nowrap px-4 py-2 text-xs text-muted-foreground'
                  >
                    <div className='max-w-[160px] truncate'>{row.customFields?.[key] || '—'}</div>
                  </td>
                ))}
                <td className='whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground'>
                  {new Date(row.createdAt).toLocaleString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className='whitespace-nowrap px-4 py-2 font-mono text-xs text-muted-foreground'>
                  {ageInDays(row.createdAt)}d
                </td>
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
  availableDesks = [],
}) => {
  const { user } = useAuth();
  const {
    dateRange,
    startTime,
    endTime,
    selectedAssigneeId,
    selectedCustomFieldKeys,
    selectedCustomFieldValues,
    setDateRange: persistDateRange,
    setSelectedAssigneeId,
    setSelectedCustomFieldKeys,
    setSelectedCustomFieldValues,
    comparedChannelIds,
    setComparedChannelIds,
  } = usePersistedDeskMetricsFilters(user?.id, channelId);

  const [activeTab, setActiveTab] = useState<'overview' | 'agents' | 'desks'>('overview');
  const [deskPickerOpen, setDeskPickerOpen] = useState(false);
  const [deskSearch, setDeskSearch] = useState('');

  const selectedDeskIds = useMemo(() => {
    const selectable = new Set(availableDesks.map(d => d.id));
    return [channelId, ...comparedChannelIds.filter(id => selectable.has(id) && id !== channelId)];
  }, [channelId, comparedChannelIds, availableDesks]);

  const isMultiDesk = selectedDeskIds.length > 1;
  const isDeskSelectionAtLimit = selectedDeskIds.length >= DESK_METRICS_MAX_AGGREGATE_DESKS;

  const toggleDesk = useCallback(
    (deskId: string) => {
      if (deskId === channelId) return;
      if (
        !comparedChannelIds.includes(deskId) &&
        selectedDeskIds.length >= DESK_METRICS_MAX_AGGREGATE_DESKS
      ) {
        return;
      }
      setComparedChannelIds(
        comparedChannelIds.includes(deskId)
          ? comparedChannelIds.filter(id => id !== deskId)
          : [...comparedChannelIds, deskId],
      );
    },
    [channelId, comparedChannelIds, selectedDeskIds.length, setComparedChannelIds],
  );

  const [chartView, setChartView] = useState<'priority' | 'assignee'>('priority');
  const [expandedChart, setExpandedChart] = useState<'priority' | 'assignee' | null>(null);
  const rangeStartMs = dateTimeMs(dateRange.startDate, startTime, false);
  const rangeEndMs = dateTimeMs(dateRange.endDate, endTime, true);
  const timeRangeParam = `${rangeStartMs}_${rangeEndMs}`;
  const [ownerSearch, setOwnerSearch] = useState('');
  const ownerSearchInputRef = useRef<HTMLInputElement>(null);
  const [fieldKeySearch, setFieldKeySearch] = useState('');
  const [fieldKeyPopoverOpen, setFieldKeyPopoverOpen] = useState(false);
  const [fieldValuePopoverOpen, setFieldValuePopoverOpen] = useState(false);
  const fieldKeySearchInputRef = useRef<HTMLInputElement>(null);
  const [customFieldTextSearches, setCustomFieldTextSearches] = useState<Record<string, string[]>>(
    {},
  );
  const [textDraftInputs, setTextDraftInputs] = useState<Record<string, string>>({});
  const [expandedFieldKeys, setExpandedFieldKeys] = useState<Record<string, boolean>>({});
  const [valueSearches, setValueSearches] = useState<Record<string, string>>({});
  const FIELD_VALUE_CAP = 100;
  // Holds selections to re-apply after time range change triggers an unfiltered fetch
  const pendingReselectRef = useRef<{
    keys: string[];
    perKeyValues: Record<string, string[]>;
  } | null>(null);
  // Always-current ref so the timeRangeParam effect never reads stale closure values
  const selectionsRef = useRef({
    keys: selectedCustomFieldKeys,
    perKeyValues: selectedCustomFieldValues,
  });
  selectionsRef.current = {
    keys: selectedCustomFieldKeys,
    perKeyValues: selectedCustomFieldValues,
  };
  // Snapshot of field→values from last unfiltered load; used to populate dropdowns even after filter is applied
  const [allFieldOptions, setAllFieldOptions] = useState<Record<string, string[]>>({});

  const activeUsers = useActiveUsers();
  const [participants] = useCachedQuery(queries.channelParticipants({ channelId }), {
    enabled: open,
  });

  // Per-key: whether each selected field is high-cardinality (text search mode)
  const perKeyIsTextSearch = useMemo(
    () =>
      Object.fromEntries(
        selectedCustomFieldKeys.map(k => [k, (allFieldOptions[k]?.length ?? 0) > FIELD_VALUE_CAP]),
      ),
    [selectedCustomFieldKeys, allFieldOptions],
  );

  const customFieldFilter =
    selectedCustomFieldKeys.length > 0
      ? {
          keys: selectedCustomFieldKeys,
          perKeyFilters: Object.fromEntries(
            selectedCustomFieldKeys.map(k => {
              if (perKeyIsTextSearch[k]) {
                const terms = customFieldTextSearches[k] ?? [];
                return [k, terms.length > 0 ? { textTerms: terms } : {}];
              }
              const vals = selectedCustomFieldValues[k] ?? [];
              return [k, vals.length > 0 ? { values: vals } : {}];
            }),
          ) as Record<string, { values?: string[]; textTerms?: string[] }>,
        }
      : undefined;

  const { data, isLoading, isFetching, isError, refetch } = useAggregateDeskMetrics(
    selectedDeskIds,
    timeRangeParam,
    open,
    selectedAssigneeId,
    customFieldFilter,
  );

  const skippedDesks: DeskMetricsSkippedDesk[] = data?.skipped ?? [];
  const perDeskRows: DeskMetricsPerDeskRow[] = data?.perDesk ?? [];

  const deskNameById = useMemo(() => {
    const map = new Map<string, string>();
    map.set(channelId, channelName ?? 'This desk');
    for (const desk of availableDesks) map.set(desk.id, desk.name);
    return map;
  }, [channelId, channelName, availableDesks]);

  // When time range changes: save selections, clear filter so unfiltered query fires for new range
  useEffect(() => {
    const { keys, perKeyValues } = selectionsRef.current;
    if (keys.length > 0) {
      pendingReselectRef.current = { keys: [...keys], perKeyValues: { ...perKeyValues } };
      setSelectedCustomFieldKeys([]);
      setSelectedCustomFieldValues({});
    }
    setCustomFieldTextSearches({});
    setTextDraftInputs({});
    setValueSearches({});
    setAllFieldOptions({});
  }, [timeRangeParam]);

  // Rebuild / update snapshot whenever fresh data arrives
  useEffect(() => {
    if (!data?.tickets || isFetching) return;

    if (selectedCustomFieldKeys.length === 0) {
      // No filter active — full replace from current range's unfiltered tickets
      const seen: Record<string, Set<string>> = {};
      for (const t of data.tickets) {
        for (const [k, v] of Object.entries(t.customFields ?? {})) {
          if (!v) continue;
          const set = (seen[k] ??= new Set());
          if (set.size <= FIELD_VALUE_CAP) set.add(v); // cap at FIELD_VALUE_CAP+1 so we know if exceeds
        }
      }
      const opts: Record<string, string[]> = {};
      for (const [k, s] of Object.entries(seen)) opts[k] = [...s].sort();
      setAllFieldOptions(opts);
      const pending = pendingReselectRef.current;
      if (pending) {
        pendingReselectRef.current = null;
        const validKeys = pending.keys.filter(k => k in opts);
        const newPerKeyValues: Record<string, string[]> = {};
        for (const k of validKeys) {
          const validVals = (pending.perKeyValues[k] ?? []).filter(v => opts[k]?.includes(v));
          if (validVals.length > 0) newPerKeyValues[k] = validVals;
        }
        setSelectedCustomFieldKeys(validKeys);
        setSelectedCustomFieldValues(newPerKeyValues);
      }
    } else {
      // Filter active — merge any new values seen in this response into the snapshot
      setAllFieldOptions(prev => {
        let changed = false;
        const updated = { ...prev };
        for (const t of data.tickets) {
          for (const [k, v] of Object.entries(t.customFields ?? {})) {
            if (!v) continue;
            const existing = updated[k];
            if (!existing) {
              updated[k] = [v];
              changed = true;
            } else if (!existing.includes(v) && existing.length <= FIELD_VALUE_CAP) {
              updated[k] = [...existing, v].sort();
              changed = true;
            }
          }
        }
        return changed ? updated : prev;
      });
    }
  }, [data?.tickets, selectedCustomFieldKeys.length, isFetching]);

  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) onClose();
  };

  const channelAssignees = useMemo(() => {
    const memberIds = new Set((participants ?? []).map(p => p.userId));
    for (const agent of data?.agents ?? []) {
      if (agent.assigneeId) memberIds.add(agent.assigneeId);
    }
    const members = (activeUsers ?? [])
      .filter(u => memberIds.has(u.id))
      .map(u => ({ id: u.id, name: u.displayName ?? u.name ?? u.email ?? u.id }));
    const q = ownerSearch.trim().toLowerCase();
    return q ? members.filter(a => a.name.toLowerCase().includes(q)) : members;
  }, [participants, activeUsers, ownerSearch, data?.agents]);

  const priorityData = (data?.priority ?? []).map(p => ({
    name: priorityLabel(p.priority),
    value: p.count,
    color: PRIORITY_COLORS[p.priority] ?? '#94a3b8',
  }));

  const assigneeData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of data?.tickets ?? []) {
      const name = t.assigneeName ?? 'Unassigned';
      counts[name] = (counts[name] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [data?.tickets]);

  // Shuffled once per mount so bar colors are random but don't flicker on re-renders
  const barColors = useMemo(
    () => [...VIZ_CHART_COLORS.series].sort(() => Math.random() - 0.5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const csatTotal = (data?.csat.good ?? 0) + (data?.csat.bad ?? 0);
  const isEmpty = !!data && data.tickets.length === 0 && data.counts.stageCounts.length === 0;

  const handleDownload = useCallback(() => {
    if (!data?.tickets) return;
    const filename = downloadCsv(data.tickets);
    showDownloadCompleteToast(filename);
  }, [data?.tickets]);

  const agents = useMemo(() => data?.agents ?? [], [data?.agents]);

  const agentTotals = useMemo(
    () => ({
      count: agents.length,
      assigned: agents.reduce((s, a) => s + a.assigned, 0),
      resolved: agents.reduce((s, a) => s + a.resolved, 0),
      reopened: agents.reduce((s, a) => s + a.reopened, 0),
      replies: agents.reduce((s, a) => s + a.emailReplies, 0),
    }),
    [agents],
  );

  const AGENT_CHART_CAP = 12;
  const agentChartData = useMemo(
    () =>
      [...agents]
        .sort((a, b) => b.assigned - a.assigned || b.resolved - a.resolved)
        .slice(0, AGENT_CHART_CAP)
        .map(a => ({
          name: agentDisplayName(a),
          assigned: a.assigned,
          resolved: a.resolved,
        })),
    [agents],
  );

  const handleDownloadAgents = useCallback(() => {
    if (agents.length === 0) return;
    const filename = downloadAgentCsv(agents);
    showDownloadCompleteToast(filename);
  }, [agents]);

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
            <div className='flex items-center gap-4'>
              <div className='flex items-center gap-2'>
                <BarChart3 size={18} className='text-desk-accent' />
                <span className='text-base font-semibold text-foreground'>
                  {isMultiDesk
                    ? `${selectedDeskIds.length} desks — Metrics`
                    : channelName
                      ? `${channelName} — Metrics`
                      : 'Desk Metrics'}
                </span>
              </div>
              <div
                role='tablist'
                aria-label='Metrics view'
                className='flex items-center gap-0.5 rounded-[8px] border border-desk-border bg-muted/30 p-0.5 dark:border-border'
              >
                {(
                  [
                    { id: 'overview', label: 'Overview' },
                    { id: 'agents', label: 'Agents' },
                    ...(isMultiDesk ? ([{ id: 'desks', label: 'By desk' }] as const) : []),
                  ] as const
                ).map(({ id, label }) => (
                  <button
                    key={id}
                    type='button'
                    role='tab'
                    aria-selected={activeTab === id}
                    onClick={() => setActiveTab(id)}
                    data-track-category='DeskMetrics'
                    data-track-name={
                      id === 'overview'
                        ? 'TabOverview'
                        : id === 'agents'
                          ? 'TabAgents'
                          : 'TabByDesk'
                    }
                    className={cn(
                      'flex items-center gap-1.5 rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
                      activeTab === id
                        ? 'bg-background text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    {id === 'overview' ? (
                      <BarChart3 size={13} />
                    ) : id === 'agents' ? (
                      <Users size={13} />
                    ) : (
                      <Layers size={13} />
                    )}
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className='flex items-center gap-3'>
              {availableDesks.length > 1 && (
                <Popover
                  open={deskPickerOpen}
                  onOpenChange={openState => {
                    setDeskPickerOpen(openState);
                    if (!openState) setDeskSearch('');
                  }}
                  align='start'
                  sideOffset={6}
                  className='p-0'
                  trigger={
                    <button
                      type='button'
                      className='flex h-[32px] w-[150px] max-w-[150px] items-center gap-1.5 rounded-[8px] border border-desk-border bg-background px-3 text-sm text-foreground shadow-none hover:bg-accent dark:border-border'
                      data-track-category='DeskMetrics'
                      data-track-name='DeskSelector'
                    >
                      <Layers size={14} className='shrink-0 text-muted-foreground' />
                      <span className='flex-1 truncate text-left text-sm'>
                        {isMultiDesk ? `${selectedDeskIds.length} desks` : '1 desk'}
                      </span>
                      {comparedChannelIds.length > 0 ? (
                        <X
                          size={12}
                          className='shrink-0 text-muted-foreground hover:text-foreground'
                          onClick={e => {
                            e.stopPropagation();
                            setComparedChannelIds([]);
                            setActiveTab(prev => (prev === 'desks' ? 'overview' : prev));
                          }}
                        />
                      ) : (
                        <ChevronDown size={12} className='shrink-0 text-muted-foreground' />
                      )}
                    </button>
                  }
                >
                  <div className='w-[260px]'>
                    <div className='flex items-center gap-2 border-b border-border px-2 py-1.5'>
                      <Search size={14} className='shrink-0 text-muted-foreground' />
                      <input
                        type='text'
                        value={deskSearch}
                        onChange={e => setDeskSearch(e.target.value)}
                        onKeyDown={e => e.stopPropagation()}
                        placeholder='Search desks…'
                        className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                        data-track-category='DeskMetrics'
                        data-track-name='SearchDesks'
                      />
                    </div>
                    <div
                      className='max-h-[260px] overflow-y-auto py-1'
                      onWheel={e => e.stopPropagation()}
                    >
                      {(() => {
                        const query = deskSearch.trim().toLowerCase();
                        const visible = availableDesks.filter(
                          d => !query || d.name.toLowerCase().includes(query),
                        );
                        if (visible.length === 0) {
                          return (
                            <div className='px-3 py-4 text-center text-sm text-muted-foreground'>
                              No desks match
                            </div>
                          );
                        }
                        return visible.map(desk => {
                          const isPrimary = desk.id === channelId;
                          const isSelected = selectedDeskIds.includes(desk.id);
                          const isDisabledByLimit = !isSelected && isDeskSelectionAtLimit;
                          return (
                            <label
                              key={desk.id}
                              className={cn(
                                'flex items-center gap-2 px-3 py-1.5 text-sm',
                                isPrimary && 'cursor-default opacity-70',
                                isDisabledByLimit && 'cursor-not-allowed opacity-50',
                                !isPrimary &&
                                  !isDisabledByLimit &&
                                  'cursor-pointer hover:bg-accent',
                              )}
                              title={
                                isPrimary
                                  ? 'The desk this dashboard was opened from is always included'
                                  : isDisabledByLimit
                                    ? `You can compare up to ${DESK_METRICS_MAX_AGGREGATE_DESKS} desks at once`
                                    : undefined
                              }
                            >
                              <input
                                type='checkbox'
                                checked={isSelected}
                                disabled={isPrimary || isDisabledByLimit}
                                onChange={() => toggleDesk(desk.id)}
                                className='h-3.5 w-3.5 accent-desk-accent'
                                data-track-category='DeskMetrics'
                                data-track-name='ToggleDesk'
                              />
                              <span className='flex-1 truncate'>{desk.name}</span>
                              {isPrimary && (
                                <span className='shrink-0 text-[10px] uppercase text-muted-foreground'>
                                  current
                                </span>
                              )}
                            </label>
                          );
                        });
                      })()}
                    </div>
                    <div
                      className={cn(
                        'border-t border-border px-3 py-2 text-xs text-muted-foreground',
                        isDeskSelectionAtLimit && 'text-amber-600 dark:text-amber-400',
                      )}
                    >
                      {selectedDeskIds.length} of {DESK_METRICS_MAX_AGGREGATE_DESKS} desks selected
                      {isDeskSelectionAtLimit && ' — limit reached'}
                    </div>
                  </div>
                </Popover>
              )}

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

              {/* Custom field filter — field key multi-select */}
              {Object.keys(allFieldOptions).length > 0 && (
                <Popover
                  open={fieldKeyPopoverOpen}
                  onOpenChange={open => {
                    setFieldKeyPopoverOpen(open);
                    if (!open) setFieldKeySearch('');
                  }}
                  align='start'
                  sideOffset={6}
                  className='p-0'
                  onOpenAutoFocus={e => {
                    e.preventDefault();
                    fieldKeySearchInputRef.current?.focus();
                  }}
                  trigger={
                    <button
                      type='button'
                      className='flex h-[32px] w-[160px] max-w-[160px] items-center gap-1.5 rounded-[8px] border border-desk-border bg-background px-3 text-sm text-foreground shadow-none hover:bg-accent dark:border-border'
                      data-track-category='DeskMetrics'
                      data-track-name='CustomFieldKeyFilter'
                    >
                      <SlidersHorizontal size={14} className='shrink-0 text-muted-foreground' />
                      <span className='flex-1 truncate text-left text-sm'>
                        {selectedCustomFieldKeys.length === 0 ? (
                          <span className='text-muted-foreground'>Filter by field</span>
                        ) : selectedCustomFieldKeys.length === 1 ? (
                          selectedCustomFieldKeys[0]
                        ) : (
                          `${selectedCustomFieldKeys.length} fields`
                        )}
                      </span>
                      {selectedCustomFieldKeys.length > 0 ? (
                        <X
                          size={12}
                          className='shrink-0 text-muted-foreground hover:text-foreground'
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedCustomFieldKeys([]);
                            setSelectedCustomFieldValues({});
                          }}
                        />
                      ) : (
                        <ChevronDown size={12} className='shrink-0 text-muted-foreground' />
                      )}
                    </button>
                  }
                >
                  <div className='w-[240px]'>
                    <div className='flex items-center gap-2 border-b border-border px-2 py-1.5'>
                      <Search size={14} className='shrink-0 text-muted-foreground' />
                      <input
                        ref={fieldKeySearchInputRef}
                        type='text'
                        value={fieldKeySearch}
                        onChange={e => setFieldKeySearch(e.target.value)}
                        placeholder='Search fields…'
                        className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                        data-track-category='DeskMetrics'
                        data-track-name='SearchFieldKeys'
                      />
                    </div>
                    <div
                      className='max-h-[220px] overflow-y-auto py-1'
                      onWheel={e => e.stopPropagation()}
                    >
                      {(() => {
                        const allKeys = Object.keys(allFieldOptions).sort();
                        const allSelected =
                          allKeys.length > 0 &&
                          allKeys.every(k => selectedCustomFieldKeys.includes(k));
                        return (
                          <label className='flex cursor-pointer items-center gap-2 border-b border-border px-3 py-1.5 text-sm font-medium hover:bg-accent'>
                            <input
                              type='checkbox'
                              checked={allSelected}
                              onChange={() => {
                                if (allSelected) {
                                  setSelectedCustomFieldKeys([]);
                                  setSelectedCustomFieldValues({});
                                } else {
                                  setSelectedCustomFieldKeys(allKeys);
                                }
                              }}
                              className='h-3.5 w-3.5 rounded accent-desk-accent'
                              data-track-category='DeskMetrics'
                              data-track-name='ToggleAllFieldKeys'
                            />
                            All fields
                          </label>
                        );
                      })()}
                      {Object.keys(allFieldOptions)
                        .sort()
                        .filter(
                          k =>
                            !fieldKeySearch ||
                            k.toLowerCase().includes(fieldKeySearch.toLowerCase()),
                        )
                        .map(k => (
                          <label
                            key={k}
                            className='flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm hover:bg-accent'
                          >
                            <input
                              type='checkbox'
                              checked={selectedCustomFieldKeys.includes(k)}
                              onChange={() => {
                                const isSelected = selectedCustomFieldKeys.includes(k);
                                if (isSelected) {
                                  const newKeys = selectedCustomFieldKeys.filter(x => x !== k);
                                  setSelectedCustomFieldKeys(newKeys);
                                  setSelectedCustomFieldValues(
                                    Object.fromEntries(
                                      Object.entries(selectedCustomFieldValues).filter(([key]) =>
                                        newKeys.includes(key),
                                      ),
                                    ) as Record<string, string[]>,
                                  );
                                  setCustomFieldTextSearches(prev =>
                                    Object.fromEntries(
                                      Object.entries(prev).filter(([key]) => newKeys.includes(key)),
                                    ),
                                  );
                                  setTextDraftInputs(prev =>
                                    Object.fromEntries(
                                      Object.entries(prev).filter(([key]) => newKeys.includes(key)),
                                    ),
                                  );
                                  setValueSearches(prev =>
                                    Object.fromEntries(
                                      Object.entries(prev).filter(([key]) => newKeys.includes(key)),
                                    ),
                                  );
                                } else {
                                  setSelectedCustomFieldKeys([...selectedCustomFieldKeys, k]);
                                }
                              }}
                              className='h-3.5 w-3.5 rounded accent-desk-accent'
                              data-track-category='DeskMetrics'
                              data-track-name='ToggleFieldKey'
                            />
                            <span className='truncate' title={k}>
                              {k}
                            </span>
                          </label>
                        ))}
                      {fieldKeySearch &&
                        Object.keys(allFieldOptions).filter(k =>
                          k.toLowerCase().includes(fieldKeySearch.toLowerCase()),
                        ).length === 0 && (
                          <div className='px-3 py-4 text-center text-sm text-muted-foreground'>
                            No fields found
                          </div>
                        )}
                    </div>
                  </div>
                </Popover>
              )}

              {/* Custom field filter — field value multi-select (shown only when keys are selected) */}
              {selectedCustomFieldKeys.length > 0 && (
                <Popover
                  open={fieldValuePopoverOpen}
                  onOpenChange={v => setFieldValuePopoverOpen(v)}
                  align='start'
                  sideOffset={6}
                  className='p-0'
                  onOpenAutoFocus={e => e.preventDefault()}
                  trigger={
                    <button
                      type='button'
                      className='flex h-[32px] w-[160px] max-w-[160px] items-center gap-1.5 rounded-[8px] border border-desk-border bg-background px-3 text-sm text-foreground shadow-none hover:bg-accent dark:border-border'
                      data-track-category='DeskMetrics'
                      data-track-name='CustomFieldValueFilter'
                    >
                      <span className='flex-1 truncate text-left text-sm'>
                        {(() => {
                          const totalSelected = Object.values(selectedCustomFieldValues).reduce(
                            (s, a) => s + a.length,
                            0,
                          );
                          const totalSearches = Object.values(customFieldTextSearches).reduce(
                            (s, a) => s + a.length,
                            0,
                          );
                          const active = totalSelected + totalSearches;
                          if (active === 0)
                            return <span className='text-muted-foreground'>Filter values</span>;
                          if (active === 1) {
                            const v =
                              Object.values(selectedCustomFieldValues).flat()[0] ??
                              Object.values(customFieldTextSearches).flat()[0];
                            return v ?? 'Filter values';
                          }
                          return `${active} filters`;
                        })()}
                      </span>
                      {Object.values(selectedCustomFieldValues).some(a => a.length > 0) ||
                      Object.values(customFieldTextSearches).some(a => a.length > 0) ? (
                        <X
                          size={12}
                          className='shrink-0 text-muted-foreground hover:text-foreground'
                          onClick={e => {
                            e.stopPropagation();
                            setSelectedCustomFieldValues({});
                            setCustomFieldTextSearches({});
                            setTextDraftInputs({});
                          }}
                        />
                      ) : (
                        <ChevronDown size={12} className='shrink-0 text-muted-foreground' />
                      )}
                    </button>
                  }
                >
                  {/* Per-key value filter panel — accordion */}
                  <div
                    className='w-[300px] max-h-[420px] overflow-y-auto'
                    onWheel={e => e.stopPropagation()}
                  >
                    {selectedCustomFieldKeys.map((k, ki) => {
                      const isHighCard = perKeyIsTextSearch[k] ?? false;
                      const keyValues = allFieldOptions[k] ?? [];
                      const selectedVals = selectedCustomFieldValues[k] ?? [];
                      const textSearch = customFieldTextSearches[k] ?? [];
                      const valueSearch = valueSearches[k] ?? '';
                      const isExpanded = expandedFieldKeys[k] ?? false;
                      const allSelected =
                        keyValues.length > 0 && keyValues.every(v => selectedVals.includes(v));
                      const filteredValues = valueSearch
                        ? keyValues.filter(v => v.toLowerCase().includes(valueSearch.toLowerCase()))
                        : keyValues;
                      return (
                        <div key={k} className={ki > 0 ? 'border-t border-border' : ''}>
                          {/* Accordion header */}
                          <div className='flex items-center gap-1 px-3 py-2'>
                            <button
                              type='button'
                              className='flex flex-1 items-center gap-1.5 text-left'
                              onClick={() =>
                                setExpandedFieldKeys(prev => ({ ...prev, [k]: !isExpanded }))
                              }
                              data-track-category='DeskMetrics'
                              data-track-name='ToggleFieldKeyAccordion'
                            >
                              <ChevronRight
                                size={13}
                                className={`shrink-0 text-muted-foreground transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                              />
                              <span className='truncate text-sm font-medium'>{k}</span>
                              {selectedVals.length > 0 && (
                                <span className='ml-1 shrink-0 text-xs text-muted-foreground'>
                                  ({selectedVals.length})
                                </span>
                              )}
                              {textSearch.length > 0 && (
                                <span className='ml-1 shrink-0 text-xs text-muted-foreground'>
                                  ({textSearch.length})
                                </span>
                              )}
                            </button>
                            {!isHighCard && keyValues.length > 0 && (
                              <button
                                type='button'
                                className='shrink-0 text-xs text-desk-accent hover:underline'
                                onClick={() =>
                                  setSelectedCustomFieldValues({
                                    ...selectedCustomFieldValues,
                                    [k]: allSelected ? [] : [...keyValues],
                                  })
                                }
                                data-track-category='DeskMetrics'
                                data-track-name='ToggleAllFieldValues'
                              >
                                {allSelected ? 'Deselect all' : 'Select all'}
                              </button>
                            )}
                          </div>

                          {/* Accordion body */}
                          {isExpanded &&
                            (isHighCard ? (
                              <div className='px-3 pb-3'>
                                {/* Applied term chips */}
                                {textSearch.length > 0 && (
                                  <div className='mb-2 flex flex-wrap gap-1'>
                                    {textSearch.map(term => (
                                      <span
                                        key={term}
                                        className='flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs text-foreground'
                                      >
                                        {term}
                                        <X
                                          size={10}
                                          className='cursor-pointer text-muted-foreground hover:text-foreground'
                                          onClick={() =>
                                            setCustomFieldTextSearches(prev => ({
                                              ...prev,
                                              [k]: (prev[k] ?? []).filter(t => t !== term),
                                            }))
                                          }
                                        />
                                      </span>
                                    ))}
                                  </div>
                                )}
                                {/* Draft input — Enter to apply */}
                                <div className='flex items-center gap-2 rounded-[6px] border border-border bg-muted/30 px-2 py-1.5'>
                                  <Search size={12} className='shrink-0 text-muted-foreground' />
                                  <input
                                    type='text'
                                    value={textDraftInputs[k] ?? ''}
                                    onChange={e =>
                                      setTextDraftInputs(prev => ({ ...prev, [k]: e.target.value }))
                                    }
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        const term = (textDraftInputs[k] ?? '').trim();
                                        if (
                                          term &&
                                          !(customFieldTextSearches[k] ?? []).includes(term)
                                        ) {
                                          setCustomFieldTextSearches(prev => ({
                                            ...prev,
                                            [k]: [...(prev[k] ?? []), term],
                                          }));
                                        }
                                        setTextDraftInputs(prev => ({ ...prev, [k]: '' }));
                                      }
                                    }}
                                    placeholder='Type and press Enter…'
                                    className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                                    data-track-category='DeskMetrics'
                                    data-track-name='CustomFieldTextSearch'
                                  />
                                  {(textDraftInputs[k] ?? '') && (
                                    <X
                                      size={11}
                                      className='shrink-0 cursor-pointer text-muted-foreground hover:text-foreground'
                                      onClick={() =>
                                        setTextDraftInputs(prev => ({ ...prev, [k]: '' }))
                                      }
                                    />
                                  )}
                                </div>
                                <p className='mt-1.5 text-[11px] text-muted-foreground'>
                                  Press Enter to add — matches any term (OR)
                                </p>
                              </div>
                            ) : (
                              <div className='pb-2'>
                                {keyValues.length > 1 && (
                                  <div
                                    className='flex items-center gap-2 border-b border-border px-3 py-1.5'
                                    data-track-category='DeskMetrics'
                                    data-track-name='SearchFieldValues'
                                  >
                                    <Search size={12} className='shrink-0 text-muted-foreground' />
                                    <input
                                      type='text'
                                      value={valueSearch}
                                      onChange={e =>
                                        setValueSearches(prev => ({ ...prev, [k]: e.target.value }))
                                      }
                                      placeholder='Search values…'
                                      className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                                      data-track-category='DeskMetrics'
                                      data-track-name='SearchFieldValues'
                                    />
                                    {valueSearch && (
                                      <X
                                        size={11}
                                        className='shrink-0 cursor-pointer text-muted-foreground hover:text-foreground'
                                        onClick={() =>
                                          setValueSearches(prev => ({ ...prev, [k]: '' }))
                                        }
                                      />
                                    )}
                                  </div>
                                )}
                                {filteredValues.map(v => (
                                  <label
                                    key={v}
                                    className='flex cursor-pointer items-center gap-2 px-3 py-1 text-sm hover:bg-accent'
                                  >
                                    <input
                                      type='checkbox'
                                      checked={selectedVals.includes(v)}
                                      onChange={() => {
                                        const next = selectedVals.includes(v)
                                          ? selectedVals.filter(x => x !== v)
                                          : [...selectedVals, v];
                                        setSelectedCustomFieldValues({
                                          ...selectedCustomFieldValues,
                                          [k]: next,
                                        });
                                      }}
                                      className='h-3.5 w-3.5 rounded accent-desk-accent'
                                      data-track-category='DeskMetrics'
                                      data-track-name='ToggleFieldValue'
                                    />
                                    <span className='block max-w-[230px] truncate' title={v}>
                                      {v}
                                    </span>
                                  </label>
                                ))}
                                {filteredValues.length === 0 && (
                                  <div className='px-3 py-2 text-xs text-muted-foreground'>
                                    {valueSearch ? 'No matching values' : 'No values found'}
                                  </div>
                                )}
                              </div>
                            ))}
                        </div>
                      );
                    })}
                  </div>
                </Popover>
              )}

              <DeskMetricsDateRangePicker
                dateRange={dateRange}
                startTime={startTime}
                endTime={endTime}
                onChange={(dr, st, et) => {
                  persistDateRange(dr, st, et);
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
            {skippedDesks.length > 0 && (
              <div className='mb-4 flex items-start gap-2 rounded-[10px] border border-amber-200 bg-amber-50 px-3 py-2 dark:border-amber-900/40 dark:bg-amber-900/15'>
                <AlertCircle size={14} className='mt-0.5 shrink-0 text-amber-600' />
                <div className='text-xs text-amber-800 dark:text-amber-300'>
                  <span className='font-medium'>
                    {skippedDesks.length === 1
                      ? '1 desk is not included:'
                      : `${skippedDesks.length} desks are not included:`}
                  </span>{' '}
                  {skippedDesks
                    .map(skip => {
                      const name = deskNameById.get(skip.channelId) ?? skip.channelId;
                      const reason =
                        skip.reason === 'metrics_disabled'
                          ? 'metrics not enabled'
                          : skip.reason === 'forbidden'
                            ? 'no access'
                            : skip.reason === 'not_found'
                              ? 'desk not found'
                              : 'failed to load';
                      return `${name} (${reason})`;
                    })
                    .join(', ')}
                </div>
              </div>
            )}
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
            ) : !data ? null : activeTab === 'desks' ? (
              <div className='overflow-x-auto rounded-[12px] border border-desk-border dark:border-border'>
                <table className='w-full min-w-[720px] text-sm'>
                  <thead>
                    <tr className='border-b border-desk-border bg-muted/30 text-left dark:border-border'>
                      <th className='px-4 py-2.5 font-medium text-muted-foreground'>Desk</th>
                      <th className='px-4 py-2.5 text-right font-medium text-muted-foreground'>
                        Opened
                      </th>
                      <th className='px-4 py-2.5 text-right font-medium text-muted-foreground'>
                        Avg first response
                      </th>
                      <th className='px-4 py-2.5 text-right font-medium text-muted-foreground'>
                        Avg resolution
                      </th>
                      <th className='px-4 py-2.5 text-right font-medium text-muted-foreground'>
                        CSAT
                      </th>
                      <th className='px-4 py-2.5 text-right font-medium text-muted-foreground'>
                        Email replies
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {perDeskRows.map(row => (
                      <tr
                        key={row.channelId}
                        className='border-b border-desk-border last:border-0 hover:bg-accent/40 dark:border-border'
                      >
                        <td className='px-4 py-2.5'>
                          <div className='flex items-center gap-2'>
                            <span className='truncate font-medium text-foreground'>
                              {row.channelName ?? deskNameById.get(row.channelId) ?? row.channelId}
                            </span>
                            {row.channelId === channelId && (
                              <span className='shrink-0 text-[10px] uppercase text-muted-foreground'>
                                current
                              </span>
                            )}
                          </div>
                        </td>
                        <td className='px-4 py-2.5 text-right tabular-nums text-foreground'>
                          {row.openedInRange}
                        </td>
                        <td className='px-4 py-2.5 text-right tabular-nums text-foreground'>
                          {formatDuration(row.avgFrtSeconds)}
                          <span className='ml-1 text-xs text-muted-foreground'>
                            ({row.respondedTickets})
                          </span>
                        </td>
                        <td className='px-4 py-2.5 text-right tabular-nums text-foreground'>
                          {formatDuration(row.avgRtSeconds)}
                          <span className='ml-1 text-xs text-muted-foreground'>
                            ({row.resolvedTickets})
                          </span>
                        </td>
                        <td className='px-4 py-2.5 text-right tabular-nums text-foreground'>
                          {row.csatAvgScore === null ? '—' : row.csatAvgScore.toFixed(2)}
                          <span className='ml-1 text-xs text-muted-foreground'>
                            ({row.csatGood}/{row.csatGood + row.csatBad})
                          </span>
                        </td>
                        <td className='px-4 py-2.5 text-right tabular-nums text-foreground'>
                          {row.emailRepliesInRange}
                        </td>
                      </tr>
                    ))}
                    {perDeskRows.length === 0 && (
                      <tr>
                        <td
                          colSpan={6}
                          className='px-4 py-10 text-center text-sm text-muted-foreground'
                        >
                          No desks contributed data in this time range
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
                <p className='border-t border-desk-border px-4 py-2 text-xs text-muted-foreground dark:border-border'>
                  Averages in parentheses show the number of tickets each average is computed over.
                  Blended totals in Overview are weighted by these counts.
                </p>
              </div>
            ) : activeTab === 'agents' ? (
              <div className='flex flex-col gap-4'>
                {agents.length === 0 ? (
                  <div className='flex flex-col items-center justify-center gap-2 rounded-[12px] border border-dashed border-desk-border py-16 text-center dark:border-border'>
                    <Users size={28} className='text-muted-foreground/70' />
                    <p className='text-sm font-medium text-foreground'>
                      No agent activity in this time range
                    </p>
                    <p className='max-w-[420px] text-xs text-muted-foreground'>
                      Agent performance is derived from tickets created in this range and replies
                      sent within it.
                    </p>
                  </div>
                ) : (
                  <>
                    <div className='grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5'>
                      <KpiCard
                        label='Agents'
                        value={String(agentTotals.count)}
                        sub='with activity'
                      />
                      <KpiCard
                        label='Total Tickets'
                        value={String(data.counts.openedInRange)}
                        sub='created in range'
                      />
                      <KpiCard
                        label='Tickets Resolved'
                        value={String(agentTotals.resolved)}
                        {...(agentTotals.assigned > 0
                          ? {
                              sub: `${Math.round((agentTotals.resolved / agentTotals.assigned) * 100)}% of assigned`,
                            }
                          : {})}
                      />
                      <KpiCard
                        label='Tickets Reopened'
                        value={String(agentTotals.reopened)}
                        sub='distinct tickets'
                      />
                      <KpiCard label='Replies Sent' value={String(agentTotals.replies)} />
                    </div>

                    <div className='flex flex-col rounded-[12px] border border-desk-border bg-background p-4 dark:border-border'>
                      <div className='mb-3 text-sm font-medium text-foreground'>
                        Assigned vs resolved by agent
                        {agents.length > AGENT_CHART_CAP && (
                          <span className='ml-1 font-normal text-muted-foreground'>
                            (top {AGENT_CHART_CAP} of {agents.length} — full list in the table
                            below)
                          </span>
                        )}
                      </div>
                      <div className='h-[280px]'>
                        <ResponsiveContainer width='100%' height='100%'>
                          <BarChart
                            data={agentChartData}
                            margin={{ left: -8, right: 16, bottom: 56 }}
                          >
                            <CartesianGrid strokeDasharray='3 3' vertical={false} />
                            <XAxis
                              dataKey='name'
                              tick={{ fontSize: 11 }}
                              interval={0}
                              tickFormatter={(name: string) =>
                                name.length > 10 ? `${name.slice(0, 9)}…` : name
                              }
                              angle={-40}
                              textAnchor='end'
                              height={70}
                            />
                            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                            <RechartsTooltip cursor={false} />
                            <Legend />
                            <Bar
                              dataKey='assigned'
                              name='Assigned'
                              fill='#6366f1'
                              radius={[4, 4, 0, 0]}
                            />
                            <Bar
                              dataKey='resolved'
                              name='Resolved'
                              fill='#10b981'
                              radius={[4, 4, 0, 0]}
                            />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    <MetricsAgentTable agents={agents} onDownload={handleDownloadAgents} />
                  </>
                )}
              </div>
            ) : (
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
                    {/* Chart panel with view selector */}
                    <div className='flex flex-col rounded-[12px] border border-desk-border bg-background p-4 dark:border-border'>
                      <div className='mb-3 flex items-center justify-between gap-3'>
                        <div className='text-sm font-medium text-foreground'>
                          {chartView === 'priority' && 'Tickets by priority'}
                          {chartView === 'assignee' && 'Tickets by assignee'}
                        </div>
                        <div className='flex items-center gap-2'>
                          <div className='flex items-center gap-0.5 rounded-[8px] border border-desk-border bg-muted/30 p-0.5 dark:border-border'>
                            <button
                              type='button'
                              onClick={() => setChartView('priority')}
                              data-track-category='DeskMetrics'
                              data-track-name='ChartViewPriority'
                              className={cn(
                                'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
                                chartView === 'priority'
                                  ? 'bg-background text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              By Priority
                            </button>
                            <button
                              type='button'
                              onClick={() => setChartView('assignee')}
                              data-track-category='DeskMetrics'
                              data-track-name='ChartViewAssignee'
                              className={cn(
                                'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
                                chartView === 'assignee'
                                  ? 'bg-background text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              By Assignee
                            </button>
                          </div>
                          <button
                            type='button'
                            onClick={() => setExpandedChart(chartView)}
                            title='Expand'
                            data-track-category='DeskMetrics'
                            data-track-name='ExpandChart'
                            className='flex h-7 w-7 items-center justify-center rounded-[6px] text-muted-foreground hover:bg-accent hover:text-foreground'
                          >
                            <Maximize2 size={13} />
                          </button>
                        </div>
                      </div>

                      {chartView === 'priority' &&
                        (priorityData.length === 0 ? (
                          <div className='flex h-[280px] items-center justify-center text-xs text-muted-foreground'>
                            No tickets in range
                          </div>
                        ) : (
                          <div className='h-[280px]'>
                            <ResponsiveContainer width='100%' height='100%'>
                              <PieChart>
                                <Pie
                                  data={priorityData}
                                  dataKey='value'
                                  nameKey='name'
                                  innerRadius={70}
                                  outerRadius={105}
                                  paddingAngle={3}
                                >
                                  {priorityData.map(entry => (
                                    <Cell key={entry.name} fill={entry.color} />
                                  ))}
                                </Pie>
                                <RechartsTooltip cursor={false} />
                                <Legend />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                        ))}

                      {chartView === 'assignee' &&
                        (assigneeData.length === 0 ? (
                          <div className='flex h-[280px] items-center justify-center text-xs text-muted-foreground'>
                            No tickets in range
                          </div>
                        ) : (
                          <div className='h-[280px]'>
                            <ResponsiveContainer width='100%' height='100%'>
                              <BarChart
                                data={assigneeData}
                                margin={{ left: -8, right: 16, bottom: 56 }}
                              >
                                <CartesianGrid strokeDasharray='3 3' vertical={false} />
                                <XAxis
                                  dataKey='name'
                                  tick={{ fontSize: 11 }}
                                  interval={0}
                                  tickFormatter={(name: string) =>
                                    name.length > 10 ? `${name.slice(0, 9)}…` : name
                                  }
                                  angle={-40}
                                  textAnchor='end'
                                  height={70}
                                />
                                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                                <RechartsTooltip
                                  cursor={false}
                                  content={({ active, payload }) => {
                                    if (!active || !payload?.length) return null;
                                    const d = payload[0];
                                    if (!d) return null;
                                    return (
                                      <div className='rounded-[8px] border border-border bg-background px-3 py-2 shadow-md'>
                                        <div className='text-sm font-medium text-foreground'>
                                          {(d.payload as { name: string }).name}
                                        </div>
                                        <div className='text-xs text-muted-foreground'>
                                          Tickets:{' '}
                                          <span className='font-semibold text-foreground'>
                                            {d.value as number}
                                          </span>
                                        </div>
                                      </div>
                                    );
                                  }}
                                />
                                <Bar dataKey='count' name='Tickets' radius={[4, 4, 0, 0]}>
                                  {assigneeData.map((_, i) => (
                                    <Cell key={i} fill={barColors[i % barColors.length]} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        ))}
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

      {/* Expanded chart overlay */}
      {expandedChart !== null && (
        <div
          className='fixed inset-0 z-[9999] flex items-center justify-center bg-black/60'
          role='button'
          tabIndex={-1}
          aria-label='Close expanded chart'
          onClick={e => {
            if (e.target === e.currentTarget) setExpandedChart(null);
          }}
          onKeyDown={e => {
            if (e.key === 'Escape') setExpandedChart(null);
          }}
          data-track-category='DeskMetrics'
          data-track-name='ExpandedChartBackdrop'
        >
          <div className='relative flex h-[80vh] w-[90vw] max-w-[1000px] flex-col rounded-[16px] bg-background p-6 shadow-2xl'>
            <div className='mb-4 flex items-center justify-between'>
              <h2 className='text-base font-semibold text-foreground'>
                {expandedChart === 'priority' && 'Tickets by priority'}
                {expandedChart === 'assignee' && 'Tickets by assignee'}
              </h2>
              <button
                type='button'
                onClick={() => setExpandedChart(null)}
                data-track-category='DeskMetrics'
                data-track-name='CloseExpandedChart'
                className='flex h-7 w-7 items-center justify-center rounded-[8px] text-muted-foreground hover:bg-accent hover:text-foreground'
              >
                <X size={16} />
              </button>
            </div>
            <div className='min-h-0 flex-1'>
              {expandedChart === 'priority' &&
                (priorityData.length === 0 ? (
                  <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
                    No tickets in range
                  </div>
                ) : (
                  <ResponsiveContainer width='100%' height='100%'>
                    <PieChart>
                      <Pie
                        data={priorityData}
                        dataKey='value'
                        nameKey='name'
                        innerRadius='30%'
                        outerRadius='55%'
                        paddingAngle={3}
                      >
                        {priorityData.map(entry => (
                          <Cell key={entry.name} fill={entry.color} />
                        ))}
                      </Pie>
                      <RechartsTooltip cursor={false} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ))}
              {expandedChart === 'assignee' &&
                (assigneeData.length === 0 ? (
                  <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
                    No tickets in range
                  </div>
                ) : (
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart data={assigneeData} margin={{ left: -8, right: 16, bottom: 64 }}>
                      <CartesianGrid strokeDasharray='3 3' vertical={false} />
                      <XAxis
                        dataKey='name'
                        tick={{ fontSize: 12 }}
                        interval={0}
                        tickFormatter={(name: string) =>
                          name.length > 10 ? `${name.slice(0, 9)}…` : name
                        }
                        angle={-40}
                        textAnchor='end'
                        height={80}
                      />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <RechartsTooltip
                        cursor={false}
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const d = payload[0];
                          if (!d) return null;
                          return (
                            <div className='rounded-[8px] border border-border bg-background px-3 py-2 shadow-md'>
                              <div className='text-sm font-medium text-foreground'>
                                {(d.payload as { name: string }).name}
                              </div>
                              <div className='text-xs text-muted-foreground'>
                                Tickets:{' '}
                                <span className='font-semibold text-foreground'>
                                  {d.value as number}
                                </span>
                              </div>
                            </div>
                          );
                        }}
                      />
                      <Bar dataKey='count' name='Tickets' radius={[6, 6, 0, 0]}>
                        {assigneeData.map((_, i) => (
                          <Cell key={i} fill={barColors[i % barColors.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ))}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
};
