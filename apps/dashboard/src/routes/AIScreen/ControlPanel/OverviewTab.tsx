import { useMemo, useState, type ReactElement } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChevronDown } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { Table, type ColumnDef } from '@/components/ui/Table';
import { Tooltip as HoverTip } from '@/components/ui/Tooltip';
import { MetricsCard } from '@/components/ClawAgents/metrics/MetricsCard';
import { Hero } from '@/components/ClawAgents/metrics/MetricsOverview';
import { ChartTooltip } from '@/components/DynamicDashboard/ComponentGrid/renderers/ChartTooltip';
import {
  CHART_GRID_DASH,
  CHART_LEGEND_HEIGHT,
  CHART_LEGEND_ICON_SIZE,
  CHART_LEGEND_STYLE,
  CHART_MARGIN,
  CHART_TOOLTIP_WRAPPER_STYLE,
  CHART_XAXIS_MIN_TICK_GAP,
} from '@/components/DynamicDashboard/ComponentGrid/renderers/constants';
import { useUsageSeries } from '@/hooks/useClawUsage';
import type {
  RateGroup,
  SeriesPoint,
  UsageOptions,
  UsageSummary,
} from '@/services/claw/clawUsageService';
import { cn } from '@/utils/classNames';
import {
  Banner,
  CHART,
  EmptyState,
  ErrorState,
  InlineSelect,
  NUM_COL,
  Num,
  QueryBody,
  TOKEN_CLASSES,
  TRACK,
  formatChange,
  formatDay,
  formatLongDay,
  formatTokens,
  formatUsd,
  niceAxis,
  plural,
  seriesColor,
  type ChartSplit,
  type ControlPanel,
  type Metric,
} from './controlPanelShared';
import { BreakdownCard } from './UsageTables';

const CHART_HEIGHT = 260;

type TooltipPayload = NonNullable<Parameters<typeof ChartTooltip>[0]['payload']>;

const SPLIT_OPTIONS: Array<{ value: ChartSplit; label: string; adminOnly?: boolean }> = [
  { value: 'none', label: 'None' },
  { value: 'agent', label: 'Agent' },
  { value: 'user', label: 'User', adminOnly: true },
  { value: 'model', label: 'Model' },
];

const pointValue = (p: SeriesPoint, metric: Metric): number =>
  metric === 'cost'
    ? p.costUsd
    : p.inputTokens + p.outputTokens + p.cacheReadTokens + p.cacheWriteTokens;

const rangeDays = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;

type TokenKey = (typeof TOKEN_CLASSES)[number]['key'];

const RATE_OF: Record<TokenKey, keyof RateGroup> = {
  inputTokens: 'inputPerMTok',
  cacheReadTokens: 'cacheReadPerMTok',
  cacheWriteTokens: 'cacheWritePerMTok',
  outputTokens: 'outputPerMTok',
};

const rateUsd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

const TOKEN_HELP: Record<TokenKey, string> = {
  inputTokens: 'Prompt sent at the full input price',
  cacheReadTokens: 'Prompt reused from the cache, at a discount',
  cacheWriteTokens: 'Prompt stored in the cache for reuse',
  outputTokens: 'Generated text, including reasoning',
};

/** Rounds parts so they add up exactly to `total` rounded the same way (largest remainder). */
function tallyRound(parts: number[], total: number, decimals: number): number[] {
  const unit = 10 ** decimals;
  const scaled = parts.map(v => v * unit);
  const units = scaled.map(Math.floor);
  const byRemainder = parts
    .map((_, i) => i)
    .sort((a, b) => scaled[b]! - units[b]! - (scaled[a]! - units[a]!));
  let left = Math.round(total * unit) - units.reduce((a, b) => a + b, 0);
  // Leftover units go to the largest remainders; any excess comes off the smallest.
  for (const i of left > 0 ? byRemainder : [...byRemainder].reverse()) {
    if (left === 0) break;
    if (left < 0 && units[i] === 0) continue;
    units[i]! += Math.sign(left);
    left -= Math.sign(left);
  }
  return units.map(u => u / unit);
}

type SplitRow = Record<string, unknown> & {
  id: TokenKey;
  label: string;
  color: string;
  tokens: number;
  cost: number;
  /** One rate for every priced token of this type, or the groups behind an average. */
  rate: { exact: number } | { avg: number; groups: RateGroup[] } | null;
};

function splitRows(s: UsageSummary, decimals: number): SplitRow[] {
  const rows = TOKEN_CLASSES.map(k => {
    const rateKey = RATE_OF[k.key];
    const groups = s.costSplit.rates.filter(g => g[k.key] > 0);
    const priced = groups.reduce((n, g) => n + g[k.key], 0);
    const cost = groups.reduce((n, g) => n + (g[k.key] * (g[rateKey] as number)) / 1e6, 0);
    const rates = new Set(groups.map(g => g[rateKey] as number));
    const rate =
      rates.size === 1
        ? { exact: [...rates][0]! }
        : priced > 0
          ? { avg: (cost / priced) * 1e6, groups }
          : null;
    return { id: k.key, label: k.label, color: k.color, tokens: s.totals[k.key], cost, rate };
  });
  const shown = tallyRound(
    rows.map(r => r.cost),
    s.totals.costUsd,
    decimals,
  );
  return rows.map((r, i) => ({ ...r, cost: shown[i] ?? 0 }));
}

const RateCell = ({ r }: { r: SplitRow }): ReactElement => {
  const rate = r.rate;
  if (!rate) return <span className='text-muted-foreground/50'>—</span>;
  if ('exact' in rate)
    return <span className='text-foreground'>{rateUsd.format(rate.exact)} / M</span>;
  const key = RATE_OF[r.id];
  return (
    <HoverTip
      content={
        <div className='flex flex-col gap-0.5 text-xs tabular-nums'>
          {rate.groups.map(g => (
            <span key={`${g.provider}/${g.model}/${g.overPromptTokens}`}>
              {g.model}
              {g.overPromptTokens > 0 &&
                ` (prompts over ${formatTokens(g.overPromptTokens)})`}:{' '}
              {rateUsd.format(g[key] as number)} / M × {formatTokens(g[r.id])}
            </span>
          ))}
        </div>
      }
    >
      <span className='cursor-help text-foreground underline decoration-dotted underline-offset-2'>
        avg {rateUsd.format(rate.avg)} / M
      </span>
    </HoverTip>
  );
};

const CostBreakdown = ({ s }: { s: UsageSummary }): ReactElement => {
  const t = s.totals;
  const c = s.costSplit;
  const decimals = t.costUsd >= 1 ? 2 : 4;
  const usd = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  const rows = splitRows(s, decimals);
  const columns: Array<ColumnDef<SplitRow>> = [
    {
      field: 'label',
      header: 'Type',
      minWidth: '16rem',
      renderCell: (_, r) => (
        <div className='flex items-start gap-2'>
          <span
            aria-hidden
            className='mt-1 size-2 shrink-0 rounded-full'
            style={{ backgroundColor: r.color }}
          />
          <div className='min-w-0'>
            <div className='font-medium text-foreground'>{r.label}</div>
            <div className='text-[11px] text-muted-foreground'>{TOKEN_HELP[r.id]}</div>
          </div>
        </div>
      ),
      renderFooter: () => (
        <span className='text-[11px] font-semibold uppercase tracking-wide'>Total in range</span>
      ),
    },
    {
      field: 'tokens',
      header: 'Tokens',
      ...NUM_COL,
      renderCell: v => <Num v={v as number} />,
      renderFooter: () => formatTokens(t.totalTokens),
    },
    {
      field: 'rate',
      header: 'Rate',
      ...NUM_COL,
      renderCell: (_, r) => <RateCell r={r} />,
    },
    {
      field: 'cost',
      header: 'Cost',
      ...NUM_COL,
      renderCell: v => (
        <span className='font-semibold text-foreground'>{usd.format(v as number)}</span>
      ),
      renderFooter: () => usd.format(t.costUsd),
    },
  ];
  return (
    <section
      id='cost-breakdown'
      aria-label='Cost and tokens by type'
      className='flex flex-col gap-2 rounded-xl border border-border bg-card p-4 shadow-sm'
    >
      <div>
        <h3 className='text-sm font-semibold text-foreground'>Cost and tokens by type</h3>
        <p className='mt-0.5 text-xs text-muted-foreground'>
          Cost is tokens × rate, in US dollars per million tokens. When the range mixes models or
          prompt-size slabs, the rate is their average; hover it for each one. The rows add up to
          the totals.
        </p>
      </div>
      <Table<SplitRow> data={rows} columns={columns} idField='id' size='sm' hoverable={false} />
      {c.uncostedCalls > 0 && (
        <p className='text-xs text-muted-foreground'>
          {plural(c.uncostedCalls, 'call')} ({formatTokens(c.uncostedTokens)} tokens) have no price,
          so they add tokens but no cost: subscription calls are included in a plan, platform models
          without a price count as $0, and API key calls aren’t counted until an admin sets a price.
        </p>
      )}
    </section>
  );
};

const BreakdownToggle = ({
  open,
  onToggle,
}: {
  open: boolean;
  onToggle: () => void;
}): ReactElement => (
  <button
    type='button'
    aria-expanded={open}
    aria-controls='cost-breakdown'
    onClick={onToggle}
    data-track-category={TRACK}
    data-track-name='kpi-breakdown'
    className='-my-1 inline-flex h-6 items-center gap-1 rounded px-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground'
  >
    Breakdown
    <ChevronDown
      className={cn('size-3.5 transition-transform', open && 'rotate-180')}
      aria-hidden
    />
  </button>
);

const Kpis = ({ s, metric }: { s: UsageSummary; metric: Metric }): ReactElement => {
  const [open, setOpen] = useState(false);
  const toggle = <BreakdownToggle open={open} onToggle={() => setOpen(v => !v)} />;
  const t = s.totals;
  const p = s.previous;
  const days = rangeDays(s.range.from, s.range.to);
  const period = days === 1 ? 'day' : `${days} days`;
  const subscription = s.byBilling.find(b => b.key === 'subscription')?.calls ?? 0;
  const cost = (
    <Hero
      key='cost'
      label='Total cost'
      value={formatUsd(t.costUsd)}
      delta={formatChange(t.costUsd, p.costUsd, true, period)}
      action={toggle}
      help={
        subscription > 0
          ? `Excludes ${plural(subscription, 'subscription call')}`
          : `Across ${plural(t.agents, 'agent')}`
      }
    />
  );
  const tokens = (
    <Hero
      key='tokens'
      label='Tokens'
      value={formatTokens(t.totalTokens)}
      delta={formatChange(t.totalTokens, p.totalTokens, false, period)}
      action={toggle}
      help={`Across ${plural(t.calls, 'model call')}`}
    />
  );
  return (
    <div className='flex flex-col gap-3'>
      <div className='grid gap-3 md:grid-cols-3'>
        {metric === 'cost' ? [cost, tokens] : [tokens, cost]}
        <Hero
          label='Sessions'
          value={formatTokens(t.sessions)}
          delta={formatChange(t.sessions, p.sessions, false, period)}
          help={`${plural(t.users, 'user')} · ${plural(t.agents, 'agent')}`}
        />
      </div>
      {open && <CostBreakdown s={s} />}
    </div>
  );
};

const KpiSkeleton = (): ReactElement => (
  <div className='grid gap-3 md:grid-cols-3'>
    {[0, 1, 2].map(i => (
      <Skeleton key={i} className='h-[104px] w-full rounded-xl' />
    ))}
  </div>
);

const CoverageBanners = ({
  s,
  isAdmin,
  onSetPrices,
}: {
  s: UsageSummary;
  isAdmin: boolean;
  onSetPrices: () => void;
}): ReactElement | null => {
  const t = s.totals;
  if (t.unpricedCalls === 0) return null;
  return (
    <Banner
      tone='warn'
      action={
        isAdmin ? (
          <Button
            variant='outline'
            size='sm'
            onClick={onSetPrices}
            data-track-category={TRACK}
            data-track-name='banner-set-prices'
          >
            Set prices
          </Button>
        ) : undefined
      }
    >
      <strong className='font-semibold'>
        {plural(t.unpricedCalls, 'call')} on API keys {t.unpricedCalls === 1 ? 'has' : 'have'} no
        price yet.
      </strong>{' '}
      Their tokens are counted, their cost is not.
      {!isAdmin && ' An admin can set prices for these models.'}
    </Banner>
  );
};

const DailyChart = ({ cp, isAdmin }: { cp: ControlPanel; isAdmin: boolean }): ReactElement => {
  const { view, update } = cp;
  const split: ChartSplit = !isAdmin && view.split === 'user' ? 'none' : view.split;
  const stacked = split !== 'none';
  // Any grouping sums to the day's total; agent shares its cache with the agent split.
  const seriesBy = split === 'none' ? 'agent' : split;
  const series = useUsageSeries(cp.params, seriesBy);
  const metric = view.metric;
  const fmt = metric === 'cost' ? formatUsd : formatTokens;
  const splitOptions = SPLIT_OPTIONS.filter(o => !o.adminOnly || isAdmin);
  const splitLabel = splitOptions.find(o => o.value === split)?.label.toLowerCase() ?? split;

  const chart = useMemo(() => {
    const data = series.data;
    if (!data) return null;
    const keys = stacked ? data.keys.map((k, i) => ({ ...k, id: `k${i}` })) : [];
    const idOf = new Map(keys.map(k => [k.key, k.id]));
    const byDay = new Map(
      data.days.map(day => [
        day,
        { day, total: 0, ...Object.fromEntries(keys.map(k => [k.id, 0])) } as Record<
          string,
          number | string
        >,
      ]),
    );
    for (const p of data.points) {
      const row = byDay.get(p.day);
      if (!row) continue;
      const v = pointValue(p, metric);
      const id = idOf.get(p.key);
      if (id) row[id] = (row[id] as number) + v;
      row['total'] = (row['total'] as number) + v;
    }
    const rows = [...byDay.values()];
    const max = Math.max(0, ...rows.map(r => r['total'] as number));
    const axis = niceAxis(max, metric === 'cost' ? 'usd' : 'tokens');
    return { keys, rows, empty: max === 0, axis };
  }, [series.data, metric, stacked]);

  return (
    <MetricsCard
      title={metric === 'cost' ? 'Daily cost' : 'Daily tokens'}
      description={
        stacked
          ? `Stacked by ${splitLabel}: the top five, the rest in Other.`
          : `Total ${metric === 'cost' ? 'cost' : 'tokens'} per day.`
      }
      action={
        <InlineSelect
          label='Split by'
          value={split}
          options={splitOptions}
          onChange={v => update({ split: v })}
          track='chart-split-by'
        />
      }
    >
      {series.isError && !series.data ? (
        <ErrorState what='daily usage' error={series.error} onRetry={() => void series.refetch()} />
      ) : !chart ? (
        <Skeleton className='w-full' style={{ height: CHART_HEIGHT }} />
      ) : chart.empty ? (
        metric === 'cost' ? (
          <div className='flex flex-col items-center gap-2 py-10 text-center'>
            <p className='text-sm font-medium text-foreground'>No priced spend in this range</p>
            <p className='text-xs text-muted-foreground'>
              Subscription and unpriced calls have no cost. Their tokens still count.
            </p>
            <Button
              variant='outline'
              size='sm'
              onClick={() => update({ metric: 'tokens' })}
              data-track-category={TRACK}
              data-track-name='chart-show-tokens'
            >
              Show tokens
            </Button>
          </div>
        ) : (
          <EmptyState />
        )
      ) : (
        <div className={cn('transition-opacity', series.isPlaceholderData && 'opacity-60')}>
          <ResponsiveContainer width='100%' height={CHART_HEIGHT}>
            <ComposedChart data={chart.rows} margin={CHART_MARGIN}>
              <CartesianGrid
                strokeDasharray={CHART_GRID_DASH}
                stroke={CHART.grid}
                vertical={false}
              />
              <XAxis
                dataKey='day'
                tick={CHART.tick}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatDay}
                minTickGap={CHART_XAXIS_MIN_TICK_GAP}
              />
              <YAxis
                tick={CHART.tick}
                tickLine={false}
                axisLine={false}
                width={56}
                domain={chart.axis.domain}
                ticks={chart.axis.ticks}
                interval={0}
                tickFormatter={chart.axis.tickFormatter}
              />
              <Tooltip
                content={({ active, payload, label }) => (
                  <ChartTooltip
                    active={!!active}
                    // Zero segments are noise in a stacked day.
                    payload={
                      (stacked
                        ? (payload ?? []).filter(p => p.value !== 0)
                        : payload) as TooltipPayload
                    }
                    label={String(label)}
                    labelFormatter={l => formatLongDay(String(l))}
                    valueFormatter={v => fmt(v)}
                  />
                )}
                wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
                cursor={stacked ? { fill: CHART.cursor, opacity: 0.4 } : { stroke: CHART.grid }}
              />
              {stacked && (
                <Legend
                  verticalAlign='top'
                  align='left'
                  height={CHART_LEGEND_HEIGHT}
                  iconSize={CHART_LEGEND_ICON_SIZE}
                  iconType='circle'
                  wrapperStyle={{ ...CHART_LEGEND_STYLE, color: CHART.other }}
                />
              )}
              {chart.keys.map((k, i) => (
                <Bar
                  key={k.id}
                  dataKey={k.id}
                  name={k.label}
                  stackId='usage'
                  fill={seriesColor(seriesBy, k.key, i)}
                  isAnimationActive={false}
                  maxBarSize={40}
                />
              ))}
              <Line
                dataKey='total'
                name={stacked ? 'Total' : metric === 'cost' ? 'Cost' : 'Tokens'}
                stroke={stacked ? 'transparent' : CHART.primary}
                strokeWidth={2}
                dot={
                  !stacked && chart.rows.length <= 31
                    ? { r: 2.5, strokeWidth: 0, fill: CHART.primary }
                    : false
                }
                activeDot={stacked ? false : { r: 4, strokeWidth: 0, fill: CHART.primary }}
                legendType='none'
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
    </MetricsCard>
  );
};

export const OverviewTab = ({
  cp,
  summary,
  isAdmin,
  options,
  onOpenSettings,
}: {
  cp: ControlPanel;
  summary: UseQueryResult<UsageSummary, Error>;
  isAdmin: boolean;
  options: UsageOptions | undefined;
  onOpenSettings: () => void;
}): ReactElement => {
  const onClear = cp.activeFilterCount > 0 ? cp.clearFilters : undefined;

  if (summary.data && summary.data.totals.calls === 0) {
    return (
      <section className='rounded-xl border border-border bg-card p-5 shadow-sm'>
        <EmptyState
          detail={
            onClear
              ? 'Nothing matches these filters. Clear them or pick a longer range.'
              : 'Usage shows up here once agents make model calls. Try a longer range.'
          }
          onClear={onClear}
        />
      </section>
    );
  }

  return (
    <div className='flex flex-col gap-5'>
      <QueryBody query={summary} what='usage totals' skeleton={<KpiSkeleton />}>
        {s => (
          <div className='flex flex-col gap-3'>
            <Kpis s={s} metric={cp.view.metric} />
            <CoverageBanners s={s} isAdmin={isAdmin} onSetPrices={onOpenSettings} />
          </div>
        )}
      </QueryBody>

      <DailyChart cp={cp} isAdmin={isAdmin} />

      <BreakdownCard cp={cp} mode='overview' isAdmin={isAdmin} options={options} />
    </div>
  );
};
