import { useCallback, useEffect, useMemo, useRef, type ReactElement, type ReactNode } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import { serializeCsv, type CsvCell } from '@xyne/shared';
import { AlertTriangle, CopyDefault, InformationCircle, Refresh, WalletDefault } from '@xyne/icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Tooltip } from '@/components/ui/Tooltip';
import UserAvatar, { AvatarShape, AvatarSize } from '@/components/UserAvatar/UserAvatar';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select';
import {
  REPORTING_PRESETS,
  matchPreset,
  type DateRangeValue,
} from '@/components/ui/DateRangeFilter/DateRangeFilter';
import { CHART_TICK_STYLE } from '@/components/DynamicDashboard/ComponentGrid/renderers/constants';
import type { MetricDelta } from '@/components/ClawAgents/metrics/formatters';
import { downloadTextFile } from '@/components/Tickets/TicketTable/ticketTableExport';
import { cn } from '@/utils/classNames';
import { copyTextToClipboard } from '@/utils/clipboardUtils';
import { formatRelativeTime } from '@/utils/dateUtils';
import { getTagTheme } from '@/utils/tagTheme';
import {
  OTHER_KEY,
  type BreakdownRow,
  type GroupBy,
  type UsageFilterParams,
} from '@/services/claw/clawUsageService';

export const TRACK = 'ai-control-panel';

const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});
const usdSmall = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 4,
});
const usdCompact = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});
const intFmt = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const compactFmt = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});

export const formatUsd = (v: number | null | undefined): string => {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (v === 0) return '$0';
  const abs = Math.abs(v);
  if (abs < 0.0001) return v < 0 ? '−<$0.0001' : '<$0.0001';
  return abs < 0.01 ? usdSmall.format(v) : usd2.format(v);
};

export const formatTokens = (v: number | null | undefined): string =>
  v === null || v === undefined || !Number.isFinite(v) ? '—' : intFmt.format(v);

export interface NiceAxis {
  domain: [number, number];
  ticks: number[];
  tickFormatter: (v: number) => string;
}

/**
 * Round ticks from 0 (steps of 1, 2, 2.5 or 5), labelled with just enough decimals to stay
 * distinct. `fixed` keeps exactly `count` steps, so a second axis lines up with the grid.
 */
export function niceAxis(max: number, unit: 'usd' | 'tokens', count = 4, fixed = false): NiceAxis {
  const hi = max > 0 && Number.isFinite(max) ? max : unit === 'usd' ? 1 : 4;
  const raw = hi / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  let step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw * (1 - 1e-9)) ?? 10 * mag;
  if (unit === 'tokens') step = Math.max(1, step);
  const n = fixed ? count : Math.ceil(hi / step - 1e-9);
  const ticks = Array.from({ length: n + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  const top = ticks[n] ?? hi;
  const stepMag = 10 ** Math.floor(Math.log10(step));
  const decimals = Math.max(
    step < 1 ? 2 : 0,
    Math.ceil(-Math.log10(step) - 1e-9) + (Math.abs(step / stepMag - 2.5) < 1e-9 ? 1 : 0),
  );
  const tickFormatter =
    unit === 'tokens'
      ? (v: number): string => compactFmt.format(v)
      : top >= 1000
        ? (v: number): string => usdCompact.format(v)
        : (v: number): string => `$${v.toFixed(decimals)}`;
  return { domain: [0, top], ticks, tickFormatter };
}

export const formatShare = (part: number, whole: number): string =>
  whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—';

/** Relative change; for spend, up is bad. Nothing to compare with means no pill. */
export const formatChange = (
  current: number,
  previous: number,
  upIsBad: boolean,
  period: string,
): MetricDelta | null => {
  if (previous === 0) return null;
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return { label: `≈ same as previous ${period}`, tone: 'flat' };
  const up = change > 0;
  return {
    label: `${up ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}% vs previous ${period}`,
    tone: upIsBad ? (up ? 'bad' : 'good') : 'flat',
  };
};

const parseDay = (day: string): Date => {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};

export const toDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const formatDay = (day: string): string =>
  parseDay(day).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

export const formatLongDay = (day: string): string =>
  parseDay(day).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });

export const formatTime = (iso: string): string =>
  new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  });

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${formatTokens(n)} ${n === 1 ? one : many}`;

export type Tone = 'good' | 'warn' | 'bad' | 'flat';

const TONE_PILL: Record<Tone, string> = {
  good: 'bg-[color-mix(in_srgb,var(--status-success)_14%,transparent)] text-status-success',
  warn: 'bg-[color-mix(in_srgb,var(--status-pending)_16%,transparent)] text-status-pending',
  bad: 'bg-[color-mix(in_srgb,var(--status-failure)_14%,transparent)] text-status-failure',
  flat: 'bg-muted text-muted-foreground',
};

export const Pill = ({ tone, children }: { tone: Tone; children: ReactNode }): ReactElement => (
  <span
    className={cn(
      'inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-1.5 py-px text-[10px] font-semibold',
      TONE_PILL[tone],
    )}
  >
    {children}
  </span>
);

export const quiet = (text: ReactNode): ReactElement => (
  <span className='text-muted-foreground/50'>{text}</span>
);

export const Dot = ({ color }: { color: string }): ReactElement => (
  <span aria-hidden className='size-2 shrink-0 rounded-full' style={{ backgroundColor: color }} />
);

/** Right-aligned, tabular numeric column; the header label lines up with the numbers. */
export const NUM_COL = {
  className: 'whitespace-nowrap text-right tabular-nums',
  headerClassName: 'whitespace-nowrap [&>div]:flex-row-reverse [&>div]:justify-start',
} as const;

export const Num = ({
  v,
  fmt = formatTokens,
  tone = 'normal',
}: {
  v: number | null | undefined;
  fmt?: (v: number) => string;
  tone?: 'lead' | 'normal' | 'muted';
}): ReactElement => (
  <span
    className={cn(
      'tabular-nums',
      !v
        ? 'text-muted-foreground/50'
        : tone === 'lead'
          ? 'font-semibold text-foreground'
          : tone === 'muted'
            ? 'text-muted-foreground'
            : 'text-foreground',
    )}
  >
    {v === null || v === undefined ? '—' : fmt(v)}
  </span>
);

export const LeadValue = ({
  share,
  children,
  width = 'min-w-[4.5rem]',
}: {
  share: number | null;
  children: ReactNode;
  width?: string;
}): ReactElement => (
  <div
    className='flex items-center justify-end gap-2'
    title={share !== null ? `${(share * 100).toFixed(1)}% of the total` : undefined}
  >
    {share !== null && (
      <span aria-hidden className='h-1.5 w-12 shrink-0 overflow-hidden rounded-full bg-muted'>
        <span
          className='block h-full rounded-full bg-action-accent/70'
          style={{ width: `${share > 0 ? Math.min(100, Math.max(share * 100, 3)) : 0}%` }}
        />
      </span>
    )}
    <span className={cn('text-right', width)}>{children}</span>
  </div>
);

export const shareOf = (v: number, total: number | undefined): number | null =>
  total && total > 0 ? Math.min(1, Math.max(0, v / total)) : null;

export const RelativeTime = ({ iso }: { iso: string }): ReactElement => (
  <Tooltip
    content={new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
  >
    <span className='whitespace-nowrap text-muted-foreground'>
      {formatRelativeTime(Date.parse(iso))}
    </span>
  </Tooltip>
);

export const AgentChip = ({
  slug,
  label,
}: {
  slug: string;
  label?: string | undefined;
}): ReactElement => {
  const name = label ?? slug;
  const theme = getTagTheme(slug);
  return (
    <span className='inline-flex min-w-0 items-center gap-1.5'>
      <span
        aria-hidden
        className={cn(
          'inline-flex size-5 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold uppercase',
          theme.bg,
          theme.text,
        )}
      >
        {name.match(/[a-z0-9]/i)?.[0] ?? '?'}
      </span>
      <span className='truncate'>{name}</span>
    </span>
  );
};

export const PersonLabel = ({
  label,
  sublabel,
  spacesUserId,
}: {
  label: string;
  sublabel?: string | undefined;
  spacesUserId?: string | undefined;
}): ReactElement => (
  <span className='inline-flex min-w-0 items-center gap-1.5'>
    {spacesUserId && (
      <UserAvatar
        userId={spacesUserId}
        size={AvatarSize.SM}
        shape={AvatarShape.CIRCULAR}
        showActiveStatus={false}
      />
    )}
    <span className='truncate'>
      {label}
      {sublabel && <span className='text-muted-foreground'> · {sublabel}</span>}
    </span>
  </span>
);

/** Quiet monospace id; the copy button shows when the enclosing `group/name` is hovered. */
export const CopyableId = ({ id, what }: { id: string; what: string }): ReactElement => (
  <span className='flex min-w-0 items-center gap-0.5'>
    <span className='truncate font-mono text-[11px] text-muted-foreground'>{id}</span>
    <button
      type='button'
      aria-label={`Copy ${what}`}
      title={`Copy ${what}`}
      onClick={e => {
        e.stopPropagation();
        copyTextToClipboard(id).then(
          () => toast.success(`Copied ${what}`),
          () => toast.error('Couldn’t copy'),
        );
      }}
      data-track-category={TRACK}
      data-track-name='copy-id'
      className='-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-foreground focus-visible:opacity-100 group-hover/name:opacity-100'
    >
      <CopyDefault className='size-3' aria-hidden />
    </button>
  </span>
);

export type Metric = 'cost' | 'tokens';

export const METRIC_OPTIONS: Array<{ value: Metric; label: string }> = [
  { value: 'cost', label: 'Cost' },
  { value: 'tokens', label: 'Tokens' },
];
export type Tab = 'overview' | 'sessions' | 'tools';
export type TableGroupBy = Extract<
  GroupBy,
  'agent' | 'user' | 'model' | 'provider' | 'ticket' | 'session' | 'pr'
>;
/** The daily chart: one total line, or stacked by one of these. */
export type ChartSplit = 'none' | 'agent' | 'user' | 'model';

export const FILTER_KEYS = ['agents', 'users', 'models', 'providers', 'tickets'] as const;
export type FilterKey = (typeof FILTER_KEYS)[number];

export interface ControlPanelView extends Record<FilterKey, string[]> {
  /** null = the default last 30 days. */
  from: string | null;
  to: string | null;
  metric: Metric;
  tab: Tab;
  groupBy: TableGroupBy;
  split: ChartSplit;
  sort: string | null;
  dir: 'asc' | 'desc' | null;
  q: string;
  page: number;
}

const TABS: Tab[] = ['overview', 'sessions', 'tools'];
const TABLE_GROUP_BYS: TableGroupBy[] = [
  'agent',
  'user',
  'model',
  'provider',
  'ticket',
  'session',
  'pr',
];
const SPLITS: ChartSplit[] = ['none', 'agent', 'user', 'model'];
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

const oneOf = <T extends string>(v: string | null, all: readonly T[], fallback: T): T =>
  v !== null && (all as readonly string[]).includes(v) ? (v as T) : fallback;

const list = (v: string | null): string[] =>
  v
    ? v
        .split(',')
        .map(s => s.trim())
        .filter(Boolean)
    : [];

function readView(sp: URLSearchParams): ControlPanelView {
  const from = sp.get('from');
  const to = sp.get('to');
  const def = defaultRange();
  const validRange =
    !!from &&
    !!to &&
    DAY_RE.test(from) &&
    DAY_RE.test(to) &&
    from <= to &&
    !(from === def.from && to === def.to);
  const dir = sp.get('dir');
  const page = Number(sp.get('page'));
  return {
    from: validRange ? from : null,
    to: validRange ? to : null,
    agents: list(sp.get('agents')),
    users: list(sp.get('users')),
    models: list(sp.get('models')),
    providers: list(sp.get('providers')),
    tickets: list(sp.get('tickets')),
    metric: sp.get('metric') === 'tokens' ? 'tokens' : 'cost',
    tab: oneOf(sp.get('tab'), TABS, 'overview'),
    groupBy: oneOf(sp.get('groupBy'), TABLE_GROUP_BYS, 'agent'),
    split: oneOf(sp.get('split'), SPLITS, 'none'),
    sort: sp.get('sort'),
    dir: dir === 'asc' || dir === 'desc' ? dir : null,
    q: sp.get('q') ?? '',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

function writeView(v: ControlPanelView): URLSearchParams {
  const sp = new URLSearchParams();
  if (v.from && v.to) {
    sp.set('from', v.from);
    sp.set('to', v.to);
  }
  for (const k of FILTER_KEYS) if (v[k].length > 0) sp.set(k, v[k].join(','));
  if (v.metric !== 'cost') sp.set('metric', v.metric);
  if (v.tab !== 'overview') sp.set('tab', v.tab);
  if (v.groupBy !== 'agent') sp.set('groupBy', v.groupBy);
  if (v.split !== 'none') sp.set('split', v.split);
  if (v.sort) sp.set('sort', v.sort);
  if (v.dir) sp.set('dir', v.dir);
  if (v.q) sp.set('q', v.q);
  if (v.page > 1) sp.set('page', String(v.page));
  return sp;
}

/** Table paging/sort/search belongs to one table, so it resets whenever the table changes. */
const TABLE_RESET = { sort: null, dir: null, q: '', page: 1 } as const;
const resetsTable = (patch: Partial<ControlPanelView>): boolean =>
  ['tab', 'groupBy', ...FILTER_KEYS, 'from', 'to'].some(k => k in patch);

export const defaultRange = (): { from: string; to: string } => {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - 29);
  return { from: toDay(start), to: toDay(end) };
};

const viewKey = (workspaceId: string | undefined): string =>
  `ai-control-panel-view-${workspaceId ?? 'default'}`;

/** A preset range is remembered by name, so "Last 7 days" still means that tomorrow. */
function loadRemembered(key: string): URLSearchParams | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as { search?: string; preset?: string };
    const sp = new URLSearchParams(stored.search ?? '');
    const preset = REPORTING_PRESETS.find(p => p.label === stored.preset)?.getValue();
    if (preset) {
      sp.set('from', toDay(preset.startDate));
      sp.set('to', toDay(preset.endDate));
    }
    return [...sp.keys()].length > 0 ? sp : null;
  } catch {
    return null;
  }
}

function remember(key: string, v: ControlPanelView): void {
  try {
    const keep = writeView({ ...v, ...TABLE_RESET });
    const preset = v.from && v.to ? matchPreset(dayRange(v.from, v.to), REPORTING_PRESETS) : null;
    if (preset) {
      keep.delete('from');
      keep.delete('to');
    }
    localStorage.setItem(key, JSON.stringify({ search: keep.toString(), preset }));
  } catch {
    // Storage blocked: the page still works, it just won't remember the view.
  }
}

export const dayRange = (from: string, to: string): DateRangeValue => {
  const endDate = parseDay(to);
  endDate.setHours(23, 59, 59, 999);
  return { startDate: parseDay(from), endDate };
};

export interface ControlPanel {
  view: ControlPanelView;
  params: UsageFilterParams;
  activeFilterCount: number;
  update: (patch: Partial<ControlPanelView>, opts?: { push?: boolean }) => void;
  clearFilters: () => void;
  search: string;
}

export function useControlPanel(): ControlPanel {
  const [sp, setSp] = useSearchParams();
  const { workspaceId } = useParams<{ workspaceId?: string }>();
  const key = viewKey(workspaceId);
  const view = useMemo(() => readView(sp), [sp]);
  const restored = useRef(false);

  useEffect(() => {
    if (restored.current) return;
    restored.current = true;
    if ([...sp.keys()].length > 0) return;
    const saved = loadRemembered(key);
    if (saved) setSp(saved, { replace: true });
  }, [key, sp, setSp]);

  useEffect(() => {
    if (restored.current) remember(key, view);
  }, [key, view]);

  const update = useCallback(
    (patch: Partial<ControlPanelView>, opts?: { push?: boolean }) => {
      setSp(
        prev => {
          const next = { ...readView(prev), ...(resetsTable(patch) ? TABLE_RESET : {}), ...patch };
          const def = defaultRange();
          if (next.from === def.from && next.to === def.to) {
            next.from = null;
            next.to = null;
          }
          return writeView(next);
        },
        { replace: !opts?.push },
      );
    },
    [setSp],
  );

  const clearFilters = useCallback(
    () =>
      update(
        { from: null, to: null, ...Object.fromEntries(FILTER_KEYS.map(k => [k, []])) },
        { push: true },
      ),
    [update],
  );

  const { from, to } = view.from && view.to ? { from: view.from, to: view.to } : defaultRange();
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);
  const params = useMemo<UsageFilterParams>(
    () => ({
      from,
      to,
      tz,
      agents: view.agents,
      users: view.users,
      models: view.models,
      providers: view.providers,
      tickets: view.tickets,
    }),
    [from, to, tz, view],
  );

  const activeFilterCount =
    FILTER_KEYS.reduce((n, k) => n + view[k].length, 0) + (view.from ? 1 : 0);

  return {
    view,
    params,
    activeFilterCount,
    update,
    clearFilters,
    search: sp.toString(),
  };
}

export function downloadCsv(name: string, headers: string[], rows: CsvCell[][]): void {
  downloadTextFile(`${name}.csv`, serializeCsv(headers, rows), 'text/csv;charset=utf-8');
}

export const BREAKDOWN_CSV_HEADERS = [
  'key',
  'label',
  'detail',
  'cost_usd',
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
  'total_tokens',
  'calls',
  'runs',
  'sessions',
  'users',
  'calls_without_usage',
  'unpriced_calls',
  'first_at',
  'last_at',
];

export const breakdownCsvRow = (r: BreakdownRow): CsvCell[] => [
  r.key,
  r.label,
  r.sublabel ?? r.prUrl ?? '',
  r.costUsd,
  r.inputTokens,
  r.outputTokens,
  r.cacheReadTokens,
  r.cacheWriteTokens,
  r.totalTokens,
  r.calls,
  r.runs,
  r.sessions,
  r.users,
  r.callsWithoutUsage,
  r.unpricedCalls,
  r.firstAt,
  r.lastAt,
];

export const chartColor = (i: number): string => `hsl(var(--chart-${(i % 5) + 1}))`;
export const CHART = {
  other: 'hsl(var(--muted-foreground))',
  grid: 'hsl(var(--border))',
  primary: 'hsl(var(--primary))',
  destructive: 'hsl(var(--destructive))',
  warning: 'hsl(var(--warning))',
  cursor: 'hsl(var(--accent))',
  tick: { ...CHART_TICK_STYLE, fill: 'hsl(var(--muted-foreground))' },
} as const;

/** One colour per token class in every chart, legend and table header. */
export const TOKEN_CLASSES = [
  { key: 'inputTokens', label: 'New input', color: chartColor(4) },
  { key: 'cacheReadTokens', label: 'Cache read', color: chartColor(1) },
  { key: 'cacheWriteTokens', label: 'Cache write', color: chartColor(3) },
  { key: 'outputTokens', label: 'Output', color: chartColor(2) },
] as const;

const PURPOSE_COLORS: Record<string, string> = {
  main: 'var(--status-scheduled)',
  subagent: 'var(--status-paused)',
  compaction: CHART.warning,
  title: chartColor(1),
  follow_up: chartColor(2),
  judge: chartColor(4),
  verify: chartColor(3),
  curator: chartColor(0),
  prefetch: 'var(--status-success)',
};
/** Stable per purpose, so a call keeps its colour across the chart and the table. */
export const seriesColor = (by: GroupBy | 'purpose', key: string, i: number): string =>
  key === OTHER_KEY
    ? CHART.other
    : by === 'purpose'
      ? (PURPOSE_COLORS[key] ?? chartColor([...key].reduce((n, ch) => n + ch.charCodeAt(0), 0)))
      : chartColor(i);

export const PageHeader = ({
  title,
  subtitle,
  note,
  right,
  leading,
}: {
  title: ReactNode;
  subtitle: ReactNode;
  note?: ReactNode;
  right?: ReactNode;
  leading?: ReactNode;
}): ReactElement => (
  <div className='mb-5 flex flex-wrap items-start justify-between gap-4'>
    <div className='flex min-w-0 items-start gap-3'>
      {leading ?? (
        <div className='flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted'>
          <WalletDefault className='size-5 text-foreground' aria-hidden />
        </div>
      )}
      <div className='min-w-0'>
        <h1 className='truncate text-xl font-semibold text-foreground'>{title}</h1>
        <p className='mt-1 text-sm text-muted-foreground'>{subtitle}</p>
        {note}
      </div>
    </div>
    {right}
  </div>
);

export const OwnUsageNote = (): ReactElement => (
  <p className='mt-2 inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 px-2.5 py-0.5 text-xs text-muted-foreground'>
    <InformationCircle className='size-3.5' aria-hidden />
    Showing your own usage
  </p>
);

export const Banner = ({
  tone,
  children,
  action,
}: {
  tone: 'info' | 'warn';
  children: ReactNode;
  action?: ReactNode;
}): ReactElement => {
  const Icon = tone === 'warn' ? AlertTriangle : InformationCircle;
  return (
    <div
      role={tone === 'warn' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2.5 rounded-xl border px-4 py-3 text-sm',
        tone === 'warn'
          ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
          : 'border-border bg-muted/40 text-muted-foreground',
      )}
    >
      <Icon className='mt-0.5 size-4 shrink-0' aria-hidden />
      <div className='min-w-0 flex-1'>{children}</div>
      {action}
    </div>
  );
};

export const EmptyState = ({
  title = 'No AI usage in this range',
  detail,
  onClear,
}: {
  title?: string;
  detail?: string;
  onClear?: (() => void) | undefined;
}): ReactElement => (
  <div className='flex flex-col items-center justify-center gap-2 py-10 text-center'>
    <p className='text-sm font-medium text-foreground'>{title}</p>
    {detail && <p className='max-w-md text-xs text-muted-foreground'>{detail}</p>}
    {onClear && (
      <Button
        variant='outline'
        size='sm'
        onClick={onClear}
        data-track-category={TRACK}
        data-track-name='empty-clear-filters'
        className='mt-1'
      >
        Clear filters
      </Button>
    )}
  </div>
);

export const ErrorState = ({
  what,
  error,
  onRetry,
}: {
  what: string;
  error: Error | null;
  onRetry: () => void;
}): ReactElement => (
  <div className='flex flex-col items-center justify-center gap-2 py-10 text-center'>
    <p className='text-sm font-medium text-foreground'>Couldn’t load {what}</p>
    {error?.message && <p className='max-w-md text-xs text-muted-foreground'>{error.message}</p>}
    <Button
      variant='outline'
      size='sm'
      onClick={onRetry}
      data-track-category={TRACK}
      data-track-name='retry-query'
      className='mt-1'
    >
      <Refresh className='size-3.5' aria-hidden />
      Retry
    </Button>
  </div>
);

export function QueryBody<T>({
  query,
  what,
  skeleton,
  isEmpty,
  empty,
  children,
}: {
  query: UseQueryResult<T, Error>;
  what: string;
  skeleton?: ReactNode;
  isEmpty?: (data: T) => boolean;
  empty?: ReactNode;
  children: (data: T) => ReactNode;
}): ReactElement {
  if (query.isError && query.data === undefined) {
    return <ErrorState what={what} error={query.error} onRetry={() => void query.refetch()} />;
  }
  if (query.data === undefined) return <>{skeleton ?? <Skeleton className='h-48 w-full' />}</>;
  if (isEmpty?.(query.data)) return <>{empty ?? <EmptyState />}</>;
  return (
    <div className={cn('transition-opacity', query.isPlaceholderData && 'opacity-60')}>
      {children(query.data)}
    </div>
  );
}

export function InlineSelect<T extends string>({
  label,
  value,
  options,
  onChange,
  track,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
  track: string;
}): ReactElement {
  return (
    <div className='flex items-center gap-2 text-xs text-muted-foreground'>
      <span aria-hidden>{label}</span>
      <Select value={value} onValueChange={v => onChange(v as T)}>
        <SelectTrigger
          size='sm'
          aria-label={label}
          className='h-8 text-xs text-foreground'
          data-track-category={TRACK}
          data-track-name={track}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map(o => (
            <SelectItem key={o.value} value={o.value} className='text-xs'>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
