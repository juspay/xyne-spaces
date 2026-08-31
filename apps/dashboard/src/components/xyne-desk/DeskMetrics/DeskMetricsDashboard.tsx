import React, { ReactElement, useMemo, useState, useCallback, useEffect } from 'react';
import { useAuth } from '../../../hooks/useAuth';
import { usePersistedDeskMetricsFilters } from '../../../hooks/usePersistedDeskMetricsFilters';
import {
  RefreshCw,
  X,
  BarChart3,
  BarChart4,
  AlertCircle,
  Check,
  Sparkles,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowUpDown,
  Download,
  Search,
  UserCircle2,
  Users,
  ListFilter,
  Circle,
  Maximize2,
  Layers,
  Tag,
} from 'lucide-react';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Popover } from '../../ui/Popover';
import {
  AICategorySubmenu,
  DynamicFieldSubmenu,
  PrioritySubmenu,
  StagesSubmenu,
  UserSubmenu,
  UserGroupSubmenu,
} from '../../Tickets/TicketFilters/Submenus';
import { classificationApi } from '../../../api/classificationApi';
import { getIconForFieldType } from '../../Tickets/TicketFilters/fieldTypeIcons';
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
  type LegendProps,
} from 'recharts';
import {
  DESK_METRICS_MAX_AGGREGATE_DESKS,
  FormFieldType,
  parseFieldOptionValues,
  type DeskMetricsAgentRow,
  type DeskMetricsPerDeskRow,
  type DeskMetricsSkippedDesk,
  type DeskMetricsTicketRow,
  type TicketStatusV2,
} from '@xyne/shared';
import type { ResolvedDisplayFormField } from '../../../utils/board/resolveDisplayFormFields';
import { Dialog } from '../../ui/Dialog/Dialog';
import { cn } from '../../../utils/classNames';
import { useAggregateDeskMetrics } from '../../../hooks/useDeskMetrics';
import { showDownloadCompleteToast } from '../../../utils/downloadToast';
import { CHART_COLORS as VIZ_CHART_COLORS } from '../../QueryVisualizations/constants';

export interface DeskMetricsSelectableDesk {
  id: string;
  name: string;
}

interface DeskMetricsStageOption {
  name: string;
  status?: TicketStatusV2;
}

type DeskMetricsCustomFieldDefinition = Pick<
  ResolvedDisplayFormField,
  'id' | 'fieldName' | 'fieldType' | 'fieldEnum'
>;

export interface DeskMetricsDashboardProps {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelName?: string;
  availableDesks?: DeskMetricsSelectableDesk[];
  customFieldDefinitions?: readonly ResolvedDisplayFormField[];
  availableStages?: readonly DeskMetricsStageOption[];
  onTicketClick: (ticket: DeskMetricsTicketRow) => void;
}

/** Shows a checklist of tags for a category, derived from already-fetched breakdown data. */
const TagsInCategorySubmenu = ({
  availableTags,
  category,
  selectedTags,
  onChange,
}: {
  availableTags: string[];
  category: string;
  selectedTags: string[];
  onChange: (tags: string[]) => void;
}): ReactElement => {
  const toggle = (tagKey: string): void => {
    onChange(
      selectedTags.includes(tagKey)
        ? selectedTags.filter(t => t !== tagKey)
        : [...selectedTags, tagKey],
    );
  };

  return (
    <div className='w-64 rounded-[10px] border border-border bg-background shadow-lg'>
      <div className='border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
        {category}
      </div>
      <div
        className='max-h-72 overflow-y-auto p-1'
        onWheel={e => e.stopPropagation()}
        onTouchMove={e => e.stopPropagation()}
      >
        {availableTags.length === 0 ? (
          <div className='p-6 text-center text-sm text-muted-foreground'>No tags available</div>
        ) : (
          <div className='space-y-0.5'>
            {availableTags.map(tagKey => {
              const tagName = tagKey.slice(category.length + 1);
              const isSelected = selectedTags.includes(tagKey);
              return (
                <button
                  key={tagKey}
                  type='button'
                  onClick={() => toggle(tagKey)}
                  data-track-category='DeskMetrics'
                  data-track-name='ToggleTagValue'
                  className={cn(
                    'flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-sm transition-colors',
                    isSelected
                      ? 'bg-accent text-accent-foreground'
                      : 'text-foreground hover:bg-muted',
                  )}
                >
                  <span className='truncate'>{tagName}</span>
                  {isSelected && <Check size={14} className='shrink-0 text-primary' />}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {selectedTags.length > 0 && (
        <div className='border-t border-border px-3 py-2 text-[11px] text-muted-foreground'>
          {selectedTags.length} selected
        </div>
      )}
    </div>
  );
};

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

const renderTagLegend = ({
  payload,
}: {
  payload?: Array<{ value: string; color: string; payload: { value: number } }>;
}): ReactElement => (
  <ul className='flex max-h-full flex-col gap-1 overflow-y-auto pl-4'>
    {(payload ?? []).map(entry => (
      <li key={entry.value} className='flex min-w-0 items-center gap-2 text-[11px]'>
        <span
          className='inline-block h-2.5 w-2.5 shrink-0 rounded-full'
          style={{ background: entry.color }}
        />
        <span className='min-w-0 flex-1 truncate text-foreground'>{entry.value}</span>
        <span className='ml-2 shrink-0 font-semibold tabular-nums text-foreground'>
          {entry.payload.value}
        </span>
      </li>
    ))}
  </ul>
);

const PAGE_SIZE = 15;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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

const formatTrendLabel = (dateStr: string, hourly: boolean): string => {
  if (hourly) {
    const hour = parseInt(dateStr.slice(11, 13), 10);
    const suffix = hour >= 12 ? 'pm' : 'am';
    return `${hour % 12 || 12}${suffix}`;
  }
  const [, month, day] = dateStr.split('-').map(Number);
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${months[(month ?? 1) - 1]} ${day}`;
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
    'Tags',
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
    `"${(t.tags ?? [])
      .map(tg => `${tg.tagCategory}:${tg.tag}`)
      .join('; ')
      .replace(/"/g, '""')}"`,
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
  onAgentClick,
}: {
  agents: DeskMetricsAgentRow[];
  onDownload: () => void;
  onAgentClick: (assigneeId: string | null) => void;
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
                      {row.assigneeId ? (
                        <button
                          type='button'
                          onClick={() => onAgentClick(row.assigneeId)}
                          data-track-category='DeskMetrics'
                          data-track-name='OpenAgentOverview'
                          data-track-metadata={JSON.stringify({ assigneeId: row.assigneeId })}
                          className='max-w-[180px] truncate text-left hover:text-desk-accent hover:underline'
                          title={agentDisplayName(row)}
                        >
                          {agentDisplayName(row)}
                        </button>
                      ) : (
                        <span className='max-w-[180px] truncate' title={agentDisplayName(row)}>
                          {agentDisplayName(row)}
                        </span>
                      )}
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
  onTicketClick,
  onAssigneeClick,
}: {
  tickets: DeskMetricsTicketRow[];
  onDownload: () => void;
  onTicketClick: (ticket: DeskMetricsTicketRow) => void;
  onAssigneeClick: (assigneeId: string) => void;
}): ReactElement => {
  const [page, setPage] = useState(0);
  const totalPages = Math.ceil(tickets.length / PAGE_SIZE);
  const pageRows = tickets.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const customFieldKeys = useMemo(() => getCustomFieldKeys(tickets), [tickets]);

  useEffect(() => {
    setPage(0);
  }, [tickets]);

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
              <th className='px-4 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground'>
                Tags
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
                  {row.xyneId ? (
                    <button
                      type='button'
                      onClick={() => onTicketClick(row)}
                      data-track-category='DeskMetrics'
                      data-track-name='OpenMetricsTicket'
                      data-track-metadata={JSON.stringify({
                        ticketId: row.ticketId,
                        channelId: row.channelId,
                        xyneId: row.xyneId,
                      })}
                      className='text-left hover:text-desk-accent hover:underline'
                    >
                      {row.xyneId}
                    </button>
                  ) : (
                    row.ticketId.slice(0, 8)
                  )}
                </td>
                <td className='px-4 py-2 text-foreground'>
                  {row.xyneId ? (
                    <button
                      type='button'
                      onClick={() => onTicketClick(row)}
                      data-track-category='DeskMetrics'
                      data-track-name='OpenMetricsTicket'
                      data-track-metadata={JSON.stringify({
                        ticketId: row.ticketId,
                        channelId: row.channelId,
                        xyneId: row.xyneId,
                      })}
                      className='max-w-[200px] truncate text-left hover:text-desk-accent hover:underline'
                    >
                      {row.title ?? '—'}
                    </button>
                  ) : (
                    <div className='max-w-[200px] truncate'>{row.title ?? '—'}</div>
                  )}
                </td>
                <td className='px-4 py-2 text-xs text-muted-foreground'>
                  {row.assigneeId ? (
                    <button
                      type='button'
                      onClick={() => onAssigneeClick(row.assigneeId!)}
                      data-track-category='DeskMetrics'
                      data-track-name='FilterByTicketAssignee'
                      data-track-metadata={JSON.stringify({ assigneeId: row.assigneeId })}
                      className='max-w-[140px] truncate text-left hover:text-desk-accent hover:underline'
                    >
                      {row.assigneeName ?? 'Unassigned'}
                    </button>
                  ) : (
                    <div className='max-w-[140px] truncate'>Unassigned</div>
                  )}
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
                <td className='px-4 py-2'>
                  {row.tags && row.tags.length > 0 ? (
                    <div className='flex flex-wrap gap-1'>
                      {row.tags.map(tg => (
                        <span
                          key={`${tg.tagCategory}:${tg.tag}`}
                          className='inline-flex items-center rounded-[4px] border border-desk-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground dark:border-border'
                          title={`${tg.tagCategory}: ${tg.tag}`}
                        >
                          {tg.tag}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <span className='text-xs text-muted-foreground'>—</span>
                  )}
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
  customFieldDefinitions = [],
  availableStages = [],
  onTicketClick,
}) => {
  const { user } = useAuth();
  const {
    dateRange,
    startTime,
    endTime,
    selectedAssigneeIds,
    selectedStageNames,
    selectedPriorities,
    selectedUserGroupIds,
    selectedTagCategory,
    selectedTagValues,
    selectedAiCategories,
    selectedCustomFieldValues,
    setDateRange: persistDateRange,
    setSelectedAssigneeIds,
    setSelectedStageNames,
    setSelectedPriorities,
    setSelectedUserGroupIds,
    setSelectedTagCategory,
    setSelectedTagValues,
    setSelectedAiCategories,
    setSelectedCustomFieldValues,
    comparedChannelIds,
    setComparedChannelIds,
    chartView,
    setChartView,
    activeTab,
    setActiveTab,
  } = usePersistedDeskMetricsFilters(user?.id, channelId);

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

  const [expandedChart, setExpandedChart] = useState<
    'priority' | 'trend' | 'assignee' | 'tags' | null
  >(null);
  const rangeStartMs = dateTimeMs(dateRange.startDate, startTime, false);
  const rangeEndMs = dateTimeMs(dateRange.endDate, endTime, true);
  const timeRangeParam = `${rangeStartMs}_${rangeEndMs}`;
  const isHourly = rangeEndMs - rangeStartMs <= DAY_MS;
  const [assigneePopoverOpen, setAssigneePopoverOpen] = useState(false);
  const [customFieldPopoverOpen, setCustomFieldPopoverOpen] = useState(false);
  const [activeSubmenu, setActiveSubmenu] = useState<string | null>(null);
  const [filterSearch, setFilterSearch] = useState('');
  // Stable tag list per category: grows as tags are seen, never shrinks.
  // Prevents mutually-exclusive tags (e.g. sentiment) from disappearing when
  // selecting one tag filters the cohort and the API stops returning the others.
  const [stableTagsInCategory, setStableTagsInCategory] = useState<string[]>([]);
  const [availableAiCategories, setAvailableAiCategories] = useState<string[]>([]);

  useEffect(() => {
    setCustomFieldPopoverOpen(false);
    setActiveSubmenu(null);
    if (!isMultiDesk && activeTab === 'desks') setActiveTab('overview');
  }, [activeTab, isMultiDesk, setActiveTab]);

  useEffect(() => {
    if (!open || !channelId || isMultiDesk) {
      setAvailableAiCategories([]);
      return;
    }
    let cancelled = false;
    setAvailableAiCategories([]);
    classificationApi
      .getAiCategories(channelId)
      .then(categories => {
        if (!cancelled) setAvailableAiCategories(categories);
      })
      .catch(() => {
        if (!cancelled) setAvailableAiCategories([]);
      });
    return (): void => {
      cancelled = true;
    };
  }, [open, channelId, isMultiDesk]);

  const customFieldDefinitionByName = useMemo(() => {
    const definitions = new Map<string, ResolvedDisplayFormField>();
    for (const definition of customFieldDefinitions) {
      if (!definitions.has(definition.fieldName)) {
        definitions.set(definition.fieldName, definition);
      }
    }
    return definitions;
  }, [customFieldDefinitions]);

  const unsupportedCustomFieldNames = useMemo(
    () =>
      new Set(
        customFieldDefinitions
          .filter(
            definition =>
              definition.fieldType === FormFieldType.DATE ||
              definition.fieldType === FormFieldType.DOC,
          )
          .map(definition => definition.fieldName.trim().toLowerCase()),
      ),
    [customFieldDefinitions],
  );

  const activeCustomFieldKeys = useMemo(
    () =>
      Object.keys(selectedCustomFieldValues)
        .filter(
          key =>
            !unsupportedCustomFieldNames.has(key.trim().toLowerCase()) &&
            (selectedCustomFieldValues[key]?.length ?? 0) > 0,
        )
        .sort(),
    [selectedCustomFieldValues, unsupportedCustomFieldNames],
  );

  const customFieldFilter =
    !isMultiDesk && activeCustomFieldKeys.length > 0
      ? {
          keys: activeCustomFieldKeys,
          perKeyFilters: Object.fromEntries(
            activeCustomFieldKeys.map(key => {
              const values = selectedCustomFieldValues[key] ?? [];
              const definition = customFieldDefinitionByName.get(key);
              return [
                key,
                definition?.fieldType === FormFieldType.STRING ? { textTerms: values } : { values },
              ];
            }),
          ) as Record<string, { values?: string[]; textTerms?: string[] }>,
        }
      : undefined;

  const hasMoreFiltersActive =
    (!isMultiDesk && selectedStageNames.length > 0) ||
    selectedPriorities.length > 0 ||
    selectedUserGroupIds.length > 0 ||
    selectedTagCategory !== null ||
    selectedTagValues.length > 0 ||
    (!isMultiDesk && selectedAiCategories.length > 0) ||
    (!isMultiDesk && activeCustomFieldKeys.length > 0);
  const hasAnyFiltersActive = selectedAssigneeIds.length > 0 || hasMoreFiltersActive;

  const updateCustomFieldValues = useCallback(
    (key: string, values: string[]): void => {
      const next = { ...selectedCustomFieldValues };
      if (values.length > 0) next[key] = values;
      else delete next[key];
      setSelectedCustomFieldValues(next);
    },
    [selectedCustomFieldValues, setSelectedCustomFieldValues],
  );

  const clearAllCustomFieldFilters = useCallback((): void => {
    setSelectedCustomFieldValues({});
  }, [setSelectedCustomFieldValues]);

  const { data, isLoading, isFetching, isError, refetch } = useAggregateDeskMetrics(
    selectedDeskIds,
    timeRangeParam,
    open,
    selectedAssigneeIds,
    customFieldFilter,
    isMultiDesk ? [] : selectedStageNames,
    selectedPriorities,
    selectedUserGroupIds,
    selectedTagValues,
    isMultiDesk ? [] : selectedAiCategories,
  );

  useEffect(() => {
    if (selectedTagCategory === null) {
      setStableTagsInCategory([]);
      return;
    }
    const fresh = (data?.tagBreakdown ?? [])
      .filter(tb => tb.tagCategory === selectedTagCategory)
      .map(tb => `${tb.tagCategory}:${tb.tag}`);
    setStableTagsInCategory(prev => {
      const prevForCategory = prev.filter(k => k.startsWith(`${selectedTagCategory}:`));
      return [...new Set([...prevForCategory, ...fresh])];
    });
  }, [selectedTagCategory, data?.tagBreakdown]);

  const availableCustomFields = useMemo(() => {
    const fields = new Map<string, DeskMetricsCustomFieldDefinition>();
    for (const definition of customFieldDefinitions) {
      const normalizedName = definition.fieldName.trim().toLowerCase();
      if (!unsupportedCustomFieldNames.has(normalizedName)) {
        fields.set(normalizedName, definition);
      }
    }
    for (const ticket of data?.tickets ?? []) {
      for (const fieldName of Object.keys(ticket.customFields ?? {})) {
        const normalizedName = fieldName.trim().toLowerCase();
        if (!unsupportedCustomFieldNames.has(normalizedName) && !fields.has(normalizedName)) {
          fields.set(normalizedName, {
            id: fieldName,
            fieldName,
            fieldType: FormFieldType.STRING,
          });
        }
      }
    }
    for (const fieldName of activeCustomFieldKeys) {
      const normalizedName = fieldName.trim().toLowerCase();
      if (!fields.has(normalizedName)) {
        fields.set(normalizedName, {
          id: fieldName,
          fieldName,
          fieldType: FormFieldType.STRING,
        });
      }
    }
    return [...fields.values()].sort((a, b) => a.fieldName.localeCompare(b.fieldName));
  }, [activeCustomFieldKeys, customFieldDefinitions, data?.tickets, unsupportedCustomFieldNames]);

  const stageOptions = availableStages;

  const skippedDesks: DeskMetricsSkippedDesk[] = data?.skipped ?? [];
  const perDeskRows: DeskMetricsPerDeskRow[] = data?.perDesk ?? [];

  const deskNameById = useMemo(() => {
    const map = new Map<string, string>();
    map.set(channelId, channelName ?? 'This desk');
    for (const desk of availableDesks) map.set(desk.id, desk.name);
    return map;
  }, [channelId, channelName, availableDesks]);

  useEffect(() => {
    if (open) void refetch();
  }, [open, refetch]);

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen) onClose();
  };

  const priorityData = (data?.priority ?? []).map(p => ({
    name: priorityLabel(p.priority),
    value: p.count,
    color: PRIORITY_COLORS[p.priority] ?? '#94a3b8',
  }));

  const tagCategoryData = useMemo(() => {
    const cats = data?.tagCategories ?? [];
    const top = cats.slice(0, 9);
    const rest = cats.slice(9);
    const result = top.map((tc, i) => ({
      name: tc.tagCategory,
      value: tc.count,
      color: VIZ_CHART_COLORS.series[i % VIZ_CHART_COLORS.series.length] ?? '#94a3b8',
    }));
    if (rest.length > 0) {
      result.push({
        name: `+${rest.length} more`,
        value: rest.reduce((s, r) => s + r.count, 0),
        color: '#94a3b8',
      });
    }
    return result;
  }, [data?.tagCategories]);

  const tagBreakdownData = useMemo(() => {
    let rows = selectedTagCategory
      ? (data?.tagBreakdown ?? []).filter(tb => tb.tagCategory === selectedTagCategory)
      : (data?.tagBreakdown ?? []);
    if (selectedTagValues.length > 0) {
      const tagSet = new Set(selectedTagValues);
      rows = rows.filter(tb => tagSet.has(`${tb.tagCategory}:${tb.tag}`));
    }
    // When specific tags are selected (Level 3), show all of them — user explicitly chose them.
    // Otherwise cap at top 9 + Others to keep the chart readable.
    if (selectedTagValues.length > 0) {
      return rows.map((tb, i) => ({
        name: tb.tag,
        value: tb.count,
        color: VIZ_CHART_COLORS.series[i % VIZ_CHART_COLORS.series.length] ?? '#94a3b8',
      }));
    }
    const top = rows.slice(0, 9);
    const rest = rows.slice(9);
    const result = top.map((tb, i) => ({
      name: tb.tag,
      value: tb.count,
      color: VIZ_CHART_COLORS.series[i % VIZ_CHART_COLORS.series.length] ?? '#94a3b8',
    }));
    if (rest.length > 0) {
      result.push({
        name: `+${rest.length} more`,
        value: rest.reduce((s, r) => s + r.count, 0),
        color: '#94a3b8',
      });
    }
    return result;
  }, [data?.tagBreakdown, selectedTagCategory, selectedTagValues]);

  const trendData = useMemo(
    () => (data?.trend ?? []).map(d => ({ ...d, label: formatTrendLabel(d.date, isHourly) })),
    [data?.trend, isHourly],
  );

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

  const tickInterval = useMemo(() => {
    const pointCount = trendData.length;
    if (pointCount <= 8) return 0;
    if (pointCount <= 31) return 4;
    return Math.floor(pointCount / 6);
  }, [trendData.length]);

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

  const handleAssigneeClick = useCallback(
    (assigneeId: string) => {
      setSelectedAssigneeIds([assigneeId]);
      setActiveTab('agents');
    },
    [setSelectedAssigneeIds, setActiveTab],
  );

  const handleAgentClick = useCallback(
    (assigneeId: string | null) => {
      if (!assigneeId) return;
      setSelectedAssigneeIds([assigneeId]);
      setActiveTab('overview');
    },
    [setSelectedAssigneeIds, setActiveTab],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={handleOpenChange}
      title='Desk Metrics'
      className={cn(
        'left-auto right-0 top-0 bottom-0 h-screen w-[85vw] max-h-none max-w-none translate-x-0 translate-y-0 rounded-l-[16px] rounded-r-none bg-transparent shadow-none',
        'data-[state=open]:!zoom-in-100 data-[state=open]:!slide-in-from-top-[0%] data-[state=open]:!slide-in-from-right-full',
        'data-[state=closed]:!zoom-out-100 data-[state=closed]:!slide-out-to-top-[0%] data-[state=closed]:!slide-out-to-right-full',
      )}
    >
      <div className='relative h-full w-full'>
        <button
          type='button'
          onClick={onClose}
          className='absolute right-6 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-[10px] border border-desk-border bg-background text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground dark:border-border'
          aria-label='Close desk metrics'
          data-track-category='DeskMetrics'
          data-track-name='CloseButton'
        >
          <X size={16} />
        </button>
        <div className='isolate flex h-full w-full flex-col overflow-hidden rounded-l-[16px] border border-desk-border bg-popover shadow-2xl dark:border-border'>
          {/* Header */}
          <div className='grid shrink-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-3 border-b border-desk-border px-6 pt-4 dark:border-border'>
            <div className='flex min-w-0 items-center gap-4 pr-12'>
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
            <div className='contents'>
              <div className='col-span-2 row-start-2 -mx-6 flex min-w-0 flex-wrap items-center justify-start gap-3 border-t border-desk-border bg-muted/20 px-6 py-3 dark:border-border'>
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
                              if (activeTab === 'desks') setActiveTab('overview');
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
                        {((): ReactElement | ReactElement[] => {
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
                        {selectedDeskIds.length} of {DESK_METRICS_MAX_AGGREGATE_DESKS} desks
                        selected
                        {isDeskSelectionAtLimit && ' — limit reached'}
                      </div>
                    </div>
                  </Popover>
                )}

                {/* Assignee filter */}
                <Popover
                  open={assigneePopoverOpen}
                  onOpenChange={setAssigneePopoverOpen}
                  align='start'
                  sideOffset={6}
                  collisionPadding={12}
                  className='border-0 bg-transparent p-0 shadow-none'
                  trigger={
                    <button
                      type='button'
                      className='flex h-[32px] min-w-[140px] items-center gap-1.5 rounded-[8px] border border-desk-border bg-background px-3 text-sm text-foreground shadow-none hover:bg-accent dark:border-border'
                      data-track-category='DeskMetrics'
                      data-track-name='AssigneeFilter'
                    >
                      <UserCircle2 size={14} className='shrink-0 text-muted-foreground' />
                      <span className='font-medium'>Assignee</span>
                      {selectedAssigneeIds.length > 0 && (
                        <span className='ml-1 rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'>
                          {selectedAssigneeIds.length}
                        </span>
                      )}
                      <ChevronDown
                        size={12}
                        className={cn(
                          'ml-auto shrink-0 text-muted-foreground transition-transform',
                          assigneePopoverOpen && 'rotate-180',
                        )}
                      />
                    </button>
                  }
                >
                  <UserSubmenu
                    selectedUsers={selectedAssigneeIds}
                    onChange={setSelectedAssigneeIds}
                    label='Assignee'
                    channelId={channelId}
                    demoteDeactivated
                  />
                </Popover>

                {/* Kanban-style additional filters */}
                <>
                  <Popover
                    open={customFieldPopoverOpen}
                    onOpenChange={nextOpen => {
                      setCustomFieldPopoverOpen(nextOpen);
                      if (!nextOpen) {
                        setActiveSubmenu(null);
                        setFilterSearch('');
                      }
                    }}
                    align='start'
                    sideOffset={6}
                    collisionPadding={12}
                    className='w-56 rounded-lg border border-border bg-background p-0 shadow-lg'
                    onInteractOutside={event => {
                      const target = event.target;
                      if (
                        target instanceof Element &&
                        target.closest('[data-custom-field-submenu="true"]')
                      ) {
                        event.preventDefault();
                      }
                    }}
                    trigger={
                      <button
                        type='button'
                        className='flex h-[32px] items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 text-sm text-foreground shadow-sm hover:bg-muted'
                        data-track-category='DeskMetrics'
                        data-track-name='OpenCustomFieldFilters'
                      >
                        <ListFilter size={13} className='shrink-0' />
                        <span className='font-medium'>More Filters</span>
                        {hasMoreFiltersActive && (
                          <span className='h-1.5 w-1.5 rounded-full bg-blue-500' />
                        )}
                      </button>
                    }
                  >
                    <>
                      <div className='flex items-center gap-2 border-b border-border px-2 py-1.5'>
                        <Search size={14} className='shrink-0 text-muted-foreground' />
                        <input
                          type='text'
                          value={filterSearch}
                          onChange={e => setFilterSearch(e.target.value)}
                          onKeyDown={e => e.stopPropagation()}
                          placeholder='Search filters…'
                          className='w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground'
                          data-track-category='DeskMetrics'
                          data-track-name='SearchFilters'
                        />
                      </div>
                      <div
                        className='max-h-[360px] overflow-y-auto py-1'
                        onWheel={e => e.stopPropagation()}
                        onTouchMove={e => e.stopPropagation()}
                      >
                        {(!filterSearch || 'priority'.includes(filterSearch.toLowerCase())) && (
                          <PopoverPrimitive.Root
                            open={activeSubmenu === '__priority'}
                            onOpenChange={nextOpen =>
                              setActiveSubmenu(nextOpen ? '__priority' : null)
                            }
                          >
                            <PopoverPrimitive.Trigger asChild>
                              <button
                                type='button'
                                className={cn(
                                  'flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-muted',
                                  activeSubmenu === '__priority' && 'bg-muted font-medium',
                                )}
                                data-track-category='DeskMetrics'
                                data-track-name='OpenPriorityFilterSubmenu'
                              >
                                <div className='flex min-w-0 items-center gap-3'>
                                  <BarChart4 size={16} className='shrink-0' />
                                  <span>Priority</span>
                                  {selectedPriorities.length > 0 && (
                                    <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500' />
                                  )}
                                </div>
                                <ChevronRight
                                  size={16}
                                  className='shrink-0 text-muted-foreground'
                                />
                              </button>
                            </PopoverPrimitive.Trigger>
                            <PopoverPrimitive.Portal>
                              <PopoverPrimitive.Content
                                side='right'
                                align='start'
                                sideOffset={4}
                                collisionPadding={12}
                                className='z-[70] outline-none'
                                data-custom-field-submenu='true'
                                onOpenAutoFocus={event => event.preventDefault()}
                              >
                                <PrioritySubmenu
                                  selectedPriorities={selectedPriorities}
                                  onChange={setSelectedPriorities}
                                />
                              </PopoverPrimitive.Content>
                            </PopoverPrimitive.Portal>
                          </PopoverPrimitive.Root>
                        )}
                        {(!filterSearch || 'user groups'.includes(filterSearch.toLowerCase())) && (
                          <PopoverPrimitive.Root
                            open={activeSubmenu === '__userGroups'}
                            onOpenChange={nextOpen =>
                              setActiveSubmenu(nextOpen ? '__userGroups' : null)
                            }
                          >
                            <PopoverPrimitive.Trigger asChild>
                              <button
                                type='button'
                                className={cn(
                                  'flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-muted',
                                  activeSubmenu === '__userGroups' && 'bg-muted font-medium',
                                )}
                                data-track-category='DeskMetrics'
                                data-track-name='OpenUserGroupFilterSubmenu'
                              >
                                <div className='flex min-w-0 items-center gap-3'>
                                  <Users size={16} className='shrink-0' />
                                  <span>User Groups</span>
                                  {selectedUserGroupIds.length > 0 && (
                                    <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500' />
                                  )}
                                </div>
                                <ChevronRight
                                  size={16}
                                  className='shrink-0 text-muted-foreground'
                                />
                              </button>
                            </PopoverPrimitive.Trigger>
                            <PopoverPrimitive.Portal>
                              <PopoverPrimitive.Content
                                side='right'
                                align='start'
                                sideOffset={4}
                                collisionPadding={12}
                                className='z-[70] outline-none'
                                data-custom-field-submenu='true'
                                onOpenAutoFocus={event => event.preventDefault()}
                              >
                                <UserGroupSubmenu
                                  selectedGroups={selectedUserGroupIds}
                                  onChange={setSelectedUserGroupIds}
                                  onClose={() => setActiveSubmenu(null)}
                                />
                              </PopoverPrimitive.Content>
                            </PopoverPrimitive.Portal>
                          </PopoverPrimitive.Root>
                        )}
                        {(!filterSearch || 'tag category'.includes(filterSearch.toLowerCase())) && (
                          <PopoverPrimitive.Root
                            open={activeSubmenu === '__tagCategory'}
                            onOpenChange={nextOpen =>
                              setActiveSubmenu(nextOpen ? '__tagCategory' : null)
                            }
                          >
                            <PopoverPrimitive.Trigger asChild>
                              <button
                                type='button'
                                className={cn(
                                  'flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-muted',
                                  activeSubmenu === '__tagCategory' && 'bg-muted font-medium',
                                )}
                                data-track-category='DeskMetrics'
                                data-track-name='OpenTagCategorySubmenu'
                              >
                                <div className='flex min-w-0 items-center gap-3'>
                                  <Tag size={16} className='shrink-0' />
                                  <span>Tag Category</span>
                                  {selectedTagCategory !== null && (
                                    <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500' />
                                  )}
                                </div>
                                <ChevronRight
                                  size={16}
                                  className='shrink-0 text-muted-foreground'
                                />
                              </button>
                            </PopoverPrimitive.Trigger>
                            <PopoverPrimitive.Portal>
                              <PopoverPrimitive.Content
                                side='right'
                                align='start'
                                sideOffset={4}
                                collisionPadding={12}
                                className='z-[70] outline-none'
                                data-custom-field-submenu='true'
                                onOpenAutoFocus={event => event.preventDefault()}
                              >
                                <div className='w-56 rounded-[10px] border border-border bg-background shadow-lg'>
                                  <div className='border-b border-border px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
                                    Select Category
                                  </div>
                                  <div
                                    className='max-h-72 overflow-y-auto p-1'
                                    onWheel={e => e.stopPropagation()}
                                    onTouchMove={e => e.stopPropagation()}
                                  >
                                    {(data?.tagCategories ?? []).length === 0 ? (
                                      <div className='p-6 text-center text-sm text-muted-foreground'>
                                        No categories
                                      </div>
                                    ) : (
                                      <div className='space-y-0.5'>
                                        {(data?.tagCategories ?? []).map(tc => (
                                          <button
                                            key={tc.tagCategory}
                                            type='button'
                                            onClick={() => {
                                              setSelectedTagCategory(
                                                selectedTagCategory === tc.tagCategory
                                                  ? null
                                                  : tc.tagCategory,
                                              );
                                              setActiveSubmenu(null);
                                            }}
                                            data-track-category='DeskMetrics'
                                            data-track-name='SelectTagCategory'
                                            className={cn(
                                              'flex w-full items-center justify-between rounded-[6px] px-3 py-2 text-sm transition-colors',
                                              selectedTagCategory === tc.tagCategory
                                                ? 'bg-accent text-accent-foreground'
                                                : 'text-foreground hover:bg-muted',
                                            )}
                                          >
                                            <span className='truncate'>{tc.tagCategory}</span>
                                            <span className='ml-2 shrink-0 text-xs text-muted-foreground'>
                                              {tc.count}
                                            </span>
                                          </button>
                                        ))}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </PopoverPrimitive.Content>
                            </PopoverPrimitive.Portal>
                          </PopoverPrimitive.Root>
                        )}
                        {/* Tags within selected category */}
                        {selectedTagCategory !== null &&
                          (!filterSearch || 'tags'.includes(filterSearch.toLowerCase())) && (
                            <PopoverPrimitive.Root
                              open={activeSubmenu === '__tags'}
                              onOpenChange={nextOpen =>
                                setActiveSubmenu(nextOpen ? '__tags' : null)
                              }
                            >
                              <PopoverPrimitive.Trigger asChild>
                                <button
                                  type='button'
                                  className={cn(
                                    'flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-muted',
                                    activeSubmenu === '__tags' && 'bg-muted font-medium',
                                  )}
                                  data-track-category='DeskMetrics'
                                  data-track-name='OpenTagsSubmenu'
                                >
                                  <div className='flex min-w-0 items-center gap-3'>
                                    <Tag size={16} className='shrink-0' />
                                    <span>Tags</span>
                                    {selectedTagValues.length > 0 && (
                                      <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500' />
                                    )}
                                  </div>
                                  <ChevronRight
                                    size={16}
                                    className='shrink-0 text-muted-foreground'
                                  />
                                </button>
                              </PopoverPrimitive.Trigger>
                              <PopoverPrimitive.Portal>
                                <PopoverPrimitive.Content
                                  side='right'
                                  align='start'
                                  sideOffset={4}
                                  collisionPadding={12}
                                  className='z-[70] outline-none'
                                  data-custom-field-submenu='true'
                                  onOpenAutoFocus={event => event.preventDefault()}
                                >
                                  <TagsInCategorySubmenu
                                    availableTags={stableTagsInCategory}
                                    category={selectedTagCategory}
                                    selectedTags={selectedTagValues}
                                    onChange={setSelectedTagValues}
                                  />
                                </PopoverPrimitive.Content>
                              </PopoverPrimitive.Portal>
                            </PopoverPrimitive.Root>
                          )}

                        {!isMultiDesk &&
                          stageOptions.length > 0 &&
                          (!filterSearch || 'stages'.includes(filterSearch.toLowerCase())) && (
                            <PopoverPrimitive.Root
                              open={activeSubmenu === '__stages'}
                              onOpenChange={nextOpen =>
                                setActiveSubmenu(nextOpen ? '__stages' : null)
                              }
                            >
                              <PopoverPrimitive.Trigger asChild>
                                <button
                                  type='button'
                                  className={cn(
                                    'flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-muted',
                                    activeSubmenu === '__stages' && 'bg-muted font-medium',
                                  )}
                                  data-track-category='DeskMetrics'
                                  data-track-name='OpenStageFilterSubmenu'
                                >
                                  <div className='flex min-w-0 items-center gap-3'>
                                    <Circle size={16} className='shrink-0' />
                                    <span>Stages</span>
                                    {selectedStageNames.length > 0 && (
                                      <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500' />
                                    )}
                                  </div>
                                  <ChevronRight
                                    size={16}
                                    className='shrink-0 text-muted-foreground'
                                  />
                                </button>
                              </PopoverPrimitive.Trigger>
                              <PopoverPrimitive.Portal>
                                <PopoverPrimitive.Content
                                  side='right'
                                  align='start'
                                  sideOffset={4}
                                  collisionPadding={12}
                                  className='z-[70] outline-none'
                                  data-custom-field-submenu='true'
                                  onOpenAutoFocus={event => event.preventDefault()}
                                >
                                  <StagesSubmenu
                                    selectedStages={selectedStageNames}
                                    onChange={setSelectedStageNames}
                                    availableStages={[...stageOptions]}
                                  />
                                </PopoverPrimitive.Content>
                              </PopoverPrimitive.Portal>
                            </PopoverPrimitive.Root>
                          )}
                        {!isMultiDesk &&
                          (!filterSearch || 'ai category'.includes(filterSearch.toLowerCase())) && (
                            <PopoverPrimitive.Root
                              open={activeSubmenu === '__aiCategory'}
                              onOpenChange={nextOpen =>
                                setActiveSubmenu(nextOpen ? '__aiCategory' : null)
                              }
                            >
                              <PopoverPrimitive.Trigger asChild>
                                <button
                                  type='button'
                                  className={cn(
                                    'flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-muted',
                                    activeSubmenu === '__aiCategory' && 'bg-muted font-medium',
                                  )}
                                  data-track-category='DeskMetrics'
                                  data-track-name='OpenAICategoryFilterSubmenu'
                                >
                                  <div className='flex min-w-0 items-center gap-3'>
                                    <Sparkles size={16} className='shrink-0' />
                                    <span>AI Category</span>
                                    {selectedAiCategories.length > 0 && (
                                      <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500' />
                                    )}
                                  </div>
                                  <ChevronRight
                                    size={16}
                                    className='shrink-0 text-muted-foreground'
                                  />
                                </button>
                              </PopoverPrimitive.Trigger>
                              <PopoverPrimitive.Portal>
                                <PopoverPrimitive.Content
                                  side='right'
                                  align='start'
                                  sideOffset={4}
                                  collisionPadding={12}
                                  className='z-[70] outline-none'
                                  data-custom-field-submenu='true'
                                  onOpenAutoFocus={event => event.preventDefault()}
                                >
                                  <AICategorySubmenu
                                    selectedCategories={selectedAiCategories}
                                    onChange={setSelectedAiCategories}
                                    availableCategories={[
                                      ...new Set([
                                        ...availableAiCategories,
                                        ...selectedAiCategories,
                                      ]),
                                    ]}
                                  />
                                </PopoverPrimitive.Content>
                              </PopoverPrimitive.Portal>
                            </PopoverPrimitive.Root>
                          )}
                        {!isMultiDesk &&
                          availableCustomFields
                            .filter(
                              def =>
                                !filterSearch ||
                                def.fieldName.toLowerCase().includes(filterSearch.toLowerCase()),
                            )
                            .map(definition => {
                              const key = definition.fieldName;
                              const FieldIcon = getIconForFieldType(definition.fieldType);
                              const isOpen = activeSubmenu === key;
                              const isActive = activeCustomFieldKeys.includes(key);

                              return (
                                <PopoverPrimitive.Root
                                  key={key}
                                  open={isOpen}
                                  onOpenChange={nextOpen => setActiveSubmenu(nextOpen ? key : null)}
                                >
                                  <PopoverPrimitive.Trigger asChild>
                                    <button
                                      type='button'
                                      className={cn(
                                        'flex w-full items-center justify-between px-4 py-2 text-sm hover:bg-muted',
                                        isOpen && 'bg-muted font-medium',
                                      )}
                                      data-track-category='DeskMetrics'
                                      data-track-name='OpenCustomFieldFilterSubmenu'
                                      data-track-metadata={JSON.stringify({ fieldName: key })}
                                    >
                                      <div className='flex min-w-0 items-center gap-3'>
                                        <FieldIcon className='h-4 w-4 shrink-0' />
                                        <span className='truncate' title={key}>
                                          {key}
                                        </span>
                                        {isActive && (
                                          <span className='h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500' />
                                        )}
                                      </div>
                                      <ChevronRight
                                        size={16}
                                        className='shrink-0 text-muted-foreground'
                                      />
                                    </button>
                                  </PopoverPrimitive.Trigger>
                                  <PopoverPrimitive.Portal>
                                    <PopoverPrimitive.Content
                                      side='right'
                                      align='start'
                                      sideOffset={4}
                                      collisionPadding={12}
                                      className='z-[70] outline-none'
                                      data-custom-field-submenu='true'
                                      onOpenAutoFocus={event => event.preventDefault()}
                                    >
                                      <DynamicFieldSubmenu
                                        fieldId={definition.id}
                                        fieldName={key}
                                        fieldType={definition.fieldType}
                                        fieldEnum={parseFieldOptionValues(definition.fieldEnum)}
                                        selectedValue={selectedCustomFieldValues[key] ?? []}
                                        onChange={value => {
                                          if (!Array.isArray(value)) return;
                                          updateCustomFieldValues(key, value);
                                        }}
                                        onClose={() => setActiveSubmenu(null)}
                                      />
                                    </PopoverPrimitive.Content>
                                  </PopoverPrimitive.Portal>
                                </PopoverPrimitive.Root>
                              );
                            })}
                      </div>
                    </>
                  </Popover>

                  {hasAnyFiltersActive && (
                    <button
                      type='button'
                      onClick={() => {
                        setSelectedAssigneeIds([]);
                        setSelectedStageNames([]);
                        setSelectedPriorities([]);
                        setSelectedUserGroupIds([]);
                        setSelectedTagCategory(null);
                        setSelectedTagValues([]);
                        setSelectedAiCategories([]);
                        clearAllCustomFieldFilters();
                      }}
                      className='flex h-[32px] items-center gap-1.5 rounded-[10px] border border-border bg-background px-3 text-sm text-foreground shadow-sm hover:bg-muted'
                      data-track-category='DeskMetrics'
                      data-track-name='ClearDeskMetricsFilters'
                    >
                      <X size={14} />
                      <span>Clear Filters</span>
                    </button>
                  )}
                </>

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
              </div>
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

                    <MetricsAgentTable
                      agents={agents}
                      onDownload={handleDownloadAgents}
                      onAgentClick={handleAgentClick}
                    />
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
                          {chartView === 'trend' &&
                            `Tickets created vs resolved ${isHourly ? '(hourly)' : '(daily)'}`}
                          {chartView === 'assignee' && 'Tickets by assignee'}
                          {chartView === 'tags' &&
                            (selectedTagCategory
                              ? `Tags in "${selectedTagCategory}"`
                              : 'Tickets by tag category')}
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
                              onClick={() => setChartView('trend')}
                              data-track-category='DeskMetrics'
                              data-track-name='ChartViewTrend'
                              className={cn(
                                'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
                                chartView === 'trend'
                                  ? 'bg-background text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              Created vs Resolved
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
                            <button
                              type='button'
                              onClick={() => setChartView('tags')}
                              data-track-category='DeskMetrics'
                              data-track-name='ChartViewTags'
                              className={cn(
                                'rounded-[6px] px-2.5 py-1 text-xs font-medium transition-colors',
                                chartView === 'tags'
                                  ? 'bg-background text-foreground shadow-sm'
                                  : 'text-muted-foreground hover:text-foreground',
                              )}
                            >
                              By Tags
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

                      {chartView === 'trend' &&
                        (trendData.length === 0 ? (
                          <div className='flex h-[280px] items-center justify-center text-xs text-muted-foreground'>
                            No data in range
                          </div>
                        ) : (
                          <div className='h-[280px]'>
                            <ResponsiveContainer width='100%' height='100%'>
                              <BarChart data={trendData} margin={{ left: -16, right: 4 }}>
                                <CartesianGrid strokeDasharray='3 3' vertical={false} />
                                <XAxis
                                  dataKey='label'
                                  tick={{ fontSize: 11 }}
                                  interval={tickInterval}
                                />
                                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                                <RechartsTooltip cursor={false} />
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

                      {chartView === 'tags' &&
                        (() => {
                          const chartData = selectedTagCategory
                            ? tagBreakdownData
                            : tagCategoryData;
                          return chartData.length === 0 ? (
                            <div className='flex h-[280px] items-center justify-center text-xs text-muted-foreground'>
                              No tag data in range
                            </div>
                          ) : (
                            <div className='h-[280px]'>
                              <ResponsiveContainer width='100%' height='100%'>
                                <PieChart>
                                  <Pie
                                    data={chartData}
                                    dataKey='value'
                                    nameKey='name'
                                    innerRadius={70}
                                    outerRadius={105}
                                    paddingAngle={3}
                                    cx='35%'
                                  >
                                    {chartData.map(entry => (
                                      <Cell key={entry.name} fill={entry.color} />
                                    ))}
                                  </Pie>
                                  <RechartsTooltip cursor={false} />
                                  <Legend
                                    layout='vertical'
                                    align='right'
                                    verticalAlign='middle'
                                    content={renderTagLegend as NonNullable<LegendProps['content']>}
                                  />
                                </PieChart>
                              </ResponsiveContainer>
                            </div>
                          );
                        })()}
                    </div>

                    {/* Ticket table */}
                    {data.tickets.length > 0 && (
                      <MetricsTicketTable
                        tickets={data.tickets}
                        onDownload={handleDownload}
                        onTicketClick={onTicketClick}
                        onAssigneeClick={handleAssigneeClick}
                      />
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
                {expandedChart === 'trend' &&
                  `Tickets created vs resolved ${isHourly ? '(hourly)' : '(daily)'}`}
                {expandedChart === 'assignee' && 'Tickets by assignee'}
                {expandedChart === 'tags' &&
                  (selectedTagCategory
                    ? `Tags in "${selectedTagCategory}"`
                    : 'Tickets by tag category')}
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
              {expandedChart === 'trend' &&
                (trendData.length === 0 ? (
                  <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
                    No data in range
                  </div>
                ) : (
                  <ResponsiveContainer width='100%' height='100%'>
                    <BarChart data={trendData} margin={{ left: -16, right: 8 }}>
                      <CartesianGrid strokeDasharray='3 3' vertical={false} />
                      <XAxis dataKey='label' tick={{ fontSize: 12 }} interval={tickInterval} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <RechartsTooltip cursor={false} />
                      <Legend />
                      <Bar dataKey='opened' name='Created' fill='#6366f1' radius={[4, 4, 0, 0]} />
                      <Bar dataKey='closed' name='Resolved' fill='#10b981' radius={[4, 4, 0, 0]} />
                    </BarChart>
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
              {expandedChart === 'tags' &&
                (() => {
                  const chartData = selectedTagCategory ? tagBreakdownData : tagCategoryData;
                  return chartData.length === 0 ? (
                    <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
                      No tag data in range
                    </div>
                  ) : (
                    <ResponsiveContainer width='100%' height='100%'>
                      <PieChart>
                        <Pie
                          data={chartData}
                          dataKey='value'
                          nameKey='name'
                          innerRadius='30%'
                          outerRadius='55%'
                          paddingAngle={3}
                          cx='35%'
                        >
                          {chartData.map(entry => (
                            <Cell key={entry.name} fill={entry.color} />
                          ))}
                        </Pie>
                        <RechartsTooltip cursor={false} />
                        <Legend
                          layout='vertical'
                          align='right'
                          verticalAlign='middle'
                          content={renderTagLegend as NonNullable<LegendProps['content']>}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  );
                })()}
            </div>
          </div>
        </div>
      )}
    </Dialog>
  );
};
