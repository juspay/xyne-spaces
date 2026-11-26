import { useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ArrowLeft } from '@xyne/icons';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { SegmentedToggle } from '@/components/ui/SegmentedToggle';
import { Table, type ColumnDef } from '@/components/ui/Table';
import { MetricsCard } from '@/components/ClawAgents/metrics/MetricsCard';
import { Tile } from '@/components/ClawAgents/metrics/MetricsOverview';
import { ChartTooltip } from '@/components/DynamicDashboard/ComponentGrid/renderers/ChartTooltip';
import {
  CHART_GRID_DASH,
  CHART_MARGIN,
  CHART_TOOLTIP_WRAPPER_STYLE,
  CHART_XAXIS_MIN_TICK_GAP,
} from '@/components/DynamicDashboard/ComponentGrid/renderers/constants';
import { useUsageSession } from '@/hooks/useClawUsage';
import { ClawApiError } from '@/services/claw/clawRequest';
import {
  BILLING_LABELS,
  PURPOSE_LABELS,
  labelFor,
  type SessionCall,
  type SessionTimeline,
} from '@/services/claw/clawUsageService';
import { cn } from '@/utils/classNames';
import {
  AgentChip,
  Banner,
  CHART,
  Dot,
  EmptyState,
  ErrorState,
  METRIC_OPTIONS,
  NUM_COL,
  Num,
  PageHeader,
  Pill,
  TOKEN_CLASSES,
  TRACK,
  downloadCsv,
  formatDateTime,
  formatShare,
  formatTime,
  formatTokens,
  formatUsd,
  niceAxis,
  plural,
  quiet,
  seriesColor,
  useControlPanel,
  type Metric,
  type Tone,
} from './controlPanelShared';
import { ExportButton } from './UsageTables';

const SYNC_ID = 'session-calls';
const PAGE = 50;

type CallRow = Record<string, unknown> &
  SessionCall & {
    i: number;
    failed: boolean;
    cost: number;
    tokens: number;
    /** Height of the baseline marker drawn for a call with nothing to show. */
    marker: number;
    lane: number;
  };

const toRows = (calls: SessionCall[], unpricedCost: number): CallRow[] =>
  calls.map((c, idx) => ({
    ...c,
    i: idx + 1,
    failed: c.outcome !== 'ok',
    cost: c.costUsd ?? unpricedCost,
    tokens: c.inputTokens + c.outputTokens + c.cacheReadTokens + c.cacheWriteTokens,
    marker: 0,
    lane: 1,
  }));

/** A subagent's own turns take the subagent colour. */
const colorKey = (c: SessionCall): string =>
  c.subagent && c.purpose === 'main' ? 'subagent' : c.purpose;
const callColor = (c: SessionCall): string => seriesColor('purpose', colorKey(c), 0);

const costText = (c: Pick<SessionCall, 'costUsd' | 'billing'>): string =>
  c.costUsd !== null
    ? formatUsd(c.costUsd)
    : c.billing === 'subscription'
      ? 'Included'
      : 'Not priced';

const purposeText = (c: SessionCall): string =>
  `${labelFor(PURPOSE_LABELS, c.purpose)}${c.subagent ? `: ${c.subagent}` : ''}`;

const statusOf = (r: CallRow): { tone: Tone; text: string } | null => {
  if (r.failed) {
    const outcome = r.outcome.replace(/_/g, ' ');
    return {
      tone: 'bad',
      text: `${outcome.charAt(0).toUpperCase()}${outcome.slice(1)}${r.usageReported ? '' : ' · no usage'}`,
    };
  }
  return r.usageReported ? null : { tone: 'warn', text: 'No usage' };
};

const uniform = <K extends keyof SessionCall>(calls: SessionCall[], k: K): SessionCall[K] | null =>
  calls.length > 0 && calls.every(c => c[k] === calls[0]![k]) ? calls[0]![k] : null;

const CallTooltip = ({
  active,
  payload,
  metric,
}: {
  active?: boolean;
  payload?: Array<{ payload?: CallRow }>;
  metric: Metric;
}): ReactElement | null => {
  const c = payload?.[0]?.payload;
  if (!active || !c) return null;
  const status = statusOf(c);
  const items = [
    ...(metric === 'tokens'
      ? TOKEN_CLASSES.map(t => ({ name: t.label, value: c[t.key], color: t.color, dataKey: t.key }))
      : [{ name: 'Cost', value: costText(c), color: callColor(c), dataKey: 'cost' }]),
    { name: 'Context sent', value: c.contextTokens, dataKey: 'contextTokens' },
    {
      name: 'Running cost',
      value: c.cumulativeCostUsd,
      color: CHART.primary,
      dataKey: 'cumulative',
    },
    { name: 'Model', value: c.model, dataKey: 'model' },
    ...(c.toolNames.length > 0
      ? [
          {
            name: 'Read',
            value: c.toolNames.slice(0, 3).join(', ') + (c.toolNames.length > 3 ? '…' : ''),
            dataKey: 'tools',
          },
        ]
      : []),
    ...(status
      ? [
          {
            name: 'Outcome',
            value: status.text,
            color: status.tone === 'bad' ? CHART.destructive : CHART.warning,
            dataKey: 'outcome',
          },
        ]
      : []),
  ];
  return (
    <ChartTooltip
      active
      label={`Call ${c.i} · ${formatTime(c.startedAt)} · ${purposeText(c)}`}
      payload={items}
      valueFormatter={(v, key) => (key === 'cumulative' ? formatUsd(v) : formatTokens(v))}
    />
  );
};

const LegendItem = ({ swatch, label }: { swatch: ReactNode; label: string }): ReactElement => (
  <span className='inline-flex items-center gap-1.5'>
    {swatch}
    {label}
  </span>
);

const Timeline = ({ s, metric }: { s: SessionTimeline; metric: Metric }): ReactElement => {
  const { rows, bars, cum } = useMemo(() => {
    const base = toRows(s.calls, 0);
    const value = (r: CallRow): number => (metric === 'cost' ? r.cost : r.tokens);
    const bars = niceAxis(Math.max(0, ...base.map(value)), metric === 'cost' ? 'usd' : 'tokens');
    const cum = niceAxis(
      Math.max(0, ...base.map(r => r.cumulativeCostUsd)),
      'usd',
      bars.ticks.length - 1,
      true,
    );
    const mark = bars.domain[1] * 0.03;
    return {
      rows: base.map(r => ({
        ...r,
        marker: (r.failed || !r.usageReported) && value(r) === 0 ? mark : 0,
      })),
      bars,
      cum,
    };
  }, [s.calls, metric]);
  const runStarts = useMemo(() => {
    const first = new Map<string, number>();
    for (const r of rows) if (r.runId && !first.has(r.runId)) first.set(r.runId, r.i);
    return s.runs.map(r => first.get(r.runId)).filter((i): i is number => i !== undefined);
  }, [rows, s.runs]);
  const compactions = rows.filter(r => r.purpose === 'compaction').map(r => r.i);
  const purposes = [...new Set(rows.map(colorKey))];
  const hasMarked = rows.some(r => r.failed || !r.usageReported);
  const labelRuns = runStarts.length <= 12;
  const dot = rows.length <= 120;

  return (
    <div className='flex flex-col gap-2'>
      <ResponsiveContainer width='100%' height={280}>
        <ComposedChart data={rows} margin={CHART_MARGIN} syncId={SYNC_ID} barCategoryGap={1}>
          <CartesianGrid strokeDasharray={CHART_GRID_DASH} stroke={CHART.grid} vertical={false} />
          <XAxis
            dataKey='i'
            tick={CHART.tick}
            tickLine={false}
            axisLine={false}
            minTickGap={CHART_XAXIS_MIN_TICK_GAP}
          />
          <YAxis
            yAxisId='bars'
            tick={CHART.tick}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={bars.domain}
            ticks={bars.ticks}
            interval={0}
            tickFormatter={bars.tickFormatter}
          />
          <YAxis
            yAxisId='cum'
            orientation='right'
            tick={CHART.tick}
            tickLine={false}
            axisLine={false}
            width={56}
            domain={cum.domain}
            ticks={cum.ticks}
            interval={0}
            tickFormatter={cum.tickFormatter}
          />
          <Tooltip
            content={<CallTooltip metric={metric} />}
            wrapperStyle={CHART_TOOLTIP_WRAPPER_STYLE}
            cursor={{ fill: CHART.cursor, opacity: 0.4 }}
          />
          {runStarts.map((i, n) => (
            <ReferenceLine
              key={`run-${i}`}
              yAxisId='bars'
              x={i}
              stroke={CHART.other}
              strokeDasharray='4 3'
              strokeOpacity={0.6}
              {...(labelRuns
                ? {
                    label: {
                      value: `Run ${n + 1}`,
                      position: 'insideTopLeft',
                      fill: CHART.other,
                      fontSize: 10,
                    },
                  }
                : {})}
            />
          ))}
          {compactions.map(i => (
            <ReferenceLine key={`compaction-${i}`} yAxisId='bars' x={i} stroke={CHART.warning} />
          ))}
          {metric === 'tokens' ? (
            TOKEN_CLASSES.map(t => (
              <Bar
                key={t.key}
                yAxisId='bars'
                dataKey={t.key}
                name={t.label}
                stackId='call'
                fill={t.color}
                isAnimationActive={false}
              />
            ))
          ) : (
            <Bar yAxisId='bars' dataKey='cost' name='Cost' stackId='call' isAnimationActive={false}>
              {rows.map(r => (
                <Cell key={r.id} fill={r.failed ? CHART.destructive : callColor(r)} />
              ))}
            </Bar>
          )}
          <Bar
            yAxisId='bars'
            dataKey='marker'
            stackId='call'
            fill={CHART.destructive}
            legendType='none'
            isAnimationActive={false}
          />
          <Line
            yAxisId='cum'
            dataKey='cumulativeCostUsd'
            name='Running cost'
            type='stepAfter'
            stroke={CHART.primary}
            strokeWidth={2}
            dot={dot ? { r: 2, fill: CHART.primary, strokeWidth: 0 } : false}
            activeDot={{ r: 4, fill: CHART.primary, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
      {metric === 'tokens' && (
        <ResponsiveContainer width='100%' height={14}>
          <BarChart
            data={rows}
            margin={{
              ...CHART_MARGIN,
              left: CHART_MARGIN.left + 56,
              right: CHART_MARGIN.right + 56,
            }}
            syncId={SYNC_ID}
            barCategoryGap={1}
          >
            <XAxis dataKey='i' hide />
            <YAxis hide domain={[0, 1]} />
            <Tooltip content={() => null} cursor={{ fill: CHART.cursor, opacity: 0.4 }} />
            <Bar dataKey='lane' isAnimationActive={false}>
              {rows.map(r => (
                <Cell key={r.id} fill={r.failed ? CHART.destructive : callColor(r)} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
      <div className='flex flex-wrap items-center gap-x-4 gap-y-1 pl-16 text-[11px] text-muted-foreground'>
        {metric === 'tokens' &&
          TOKEN_CLASSES.map(t => (
            <LegendItem
              key={t.key}
              swatch={<span className='size-2 rounded-sm' style={{ backgroundColor: t.color }} />}
              label={t.label}
            />
          ))}
        <LegendItem
          swatch={
            <span
              className='relative h-0.5 w-4 rounded-full'
              style={{ backgroundColor: CHART.primary }}
            >
              <span
                className='absolute left-1/2 top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full'
                style={{ backgroundColor: CHART.primary }}
              />
            </span>
          }
          label='Running cost'
        />
        <LegendItem
          swatch={
            <span className='h-3 border-l border-dashed' style={{ borderColor: CHART.other }} />
          }
          label='Run start'
        />
        {compactions.length > 0 && (
          <LegendItem
            swatch={<span className='h-3 border-l' style={{ borderColor: CHART.warning }} />}
            label='Compaction'
          />
        )}
        <span aria-hidden className='h-3 w-px bg-border' />
        {purposes.map(k => (
          <LegendItem
            key={k}
            swatch={<Dot color={seriesColor('purpose', k, 0)} />}
            label={labelFor(PURPOSE_LABELS, k)}
          />
        ))}
        {hasMarked && (
          <LegendItem swatch={<Dot color={CHART.destructive} />} label='Failed or no usage' />
        )}
      </div>
    </div>
  );
};

const Strong = ({ children }: { children: ReactNode }): ReactElement => (
  <span className='font-semibold tabular-nums text-foreground'>{children}</span>
);

const GrowthSummary = ({ s }: { s: SessionTimeline }): ReactElement | null => {
  const calls = s.calls;
  if (calls.length === 0) return null;
  const peak = calls.reduce((m, c) => Math.max(m, c.contextTokens), 0);
  const priciest = calls.reduce<{ c: SessionCall; i: number } | null>(
    (best, c, i) => ((c.costUsd ?? 0) > (best?.c.costUsd ?? 0) ? { c, i } : best),
    null,
  );
  const compactions = calls.filter(c => c.purpose === 'compaction').length;
  return (
    <p className='mt-3 text-xs leading-relaxed text-muted-foreground'>
      Context grew from <Strong>{formatTokens(calls[0]!.contextTokens)}</Strong> to a peak of{' '}
      <Strong>{formatTokens(peak)}</Strong> tokens over {plural(calls.length, 'call')}.
      {priciest && s.totals.costUsd > 0 && (
        <>
          {' '}
          The most expensive call was <Strong>#{priciest.i + 1}</Strong> at{' '}
          <Strong>{formatUsd(priciest.c.costUsd)}</Strong> (
          {formatShare(priciest.c.costUsd ?? 0, s.totals.costUsd)} of the session).
        </>
      )}
      {compactions > 0 && <> Compacted {plural(compactions, 'time')}.</>}
    </p>
  );
};

const PurposeCell = ({ r }: { r: CallRow }): ReactElement => {
  const status = statusOf(r);
  const tools = r.toolNames;
  return (
    <div className='min-w-0 max-w-[18rem]'>
      <div className='flex items-center gap-1.5 whitespace-nowrap'>
        <Dot color={callColor(r)} />
        <span className='truncate text-foreground'>{purposeText(r)}</span>
        {status && <Pill tone={status.tone}>{status.text}</Pill>}
      </div>
      {tools.length > 0 && (
        <div className='truncate pl-3.5 text-[11px] text-muted-foreground' title={tools.join(', ')}>
          read <span className='font-mono'>{tools.slice(0, 2).join(', ')}</span>
          {tools.length > 2 && ` +${tools.length - 2}`}
        </div>
      )}
    </div>
  );
};

const CallsTable = ({
  s,
  conversationId,
  metric,
}: {
  s: SessionTimeline;
  conversationId: string;
  metric: Metric;
}): ReactElement => {
  const [page, setPage] = useState(1);
  const rows = useMemo(() => toRows(s.calls, -1), [s.calls]);
  const billing = uniform(s.calls, 'billing');
  const provider = uniform(s.calls, 'provider');
  const model = uniform(s.calls, 'model');
  const servedDiffers = s.calls.some(c => c.servedModel && c.servedModel !== c.model);
  const showModel = model === null || servedDiffers;
  const shared = [
    billing !== null ? labelFor(BILLING_LABELS, billing) : null,
    provider,
    showModel ? null : model,
  ].filter(Boolean);

  const tokenCol = (t: (typeof TOKEN_CLASSES)[number]): ColumnDef<CallRow> => ({
    field: t.key,
    header: t.label,
    sortable: true,
    ...NUM_COL,
    renderHeader: () => (
      <span className='inline-flex items-center gap-1.5'>
        <Dot color={t.color} />
        {t.label}
      </span>
    ),
    renderCell: (v, r) =>
      r.usageReported ? (
        <Num v={v as number} tone={metric === 'tokens' ? 'normal' : 'muted'} />
      ) : (
        quiet('—')
      ),
  });
  const costCol: ColumnDef<CallRow> = {
    field: 'cost',
    header: 'Cost',
    sortable: true,
    ...NUM_COL,
    renderCell: (_, r) =>
      r.costUsd === null ? (
        <span className='text-[11px] text-muted-foreground'>{costText(r)}</span>
      ) : (
        <Num v={r.costUsd} fmt={formatUsd} tone={metric === 'cost' ? 'lead' : 'normal'} />
      ),
  };
  const runningCol: ColumnDef<CallRow> = {
    field: 'cumulativeCostUsd',
    header: 'Running cost',
    sortable: true,
    ...NUM_COL,
    renderCell: v => <Num v={v as number} fmt={formatUsd} tone='muted' />,
  };
  const totalCol: ColumnDef<CallRow> = {
    field: 'tokens',
    header: 'Tokens',
    sortable: true,
    ...NUM_COL,
    renderCell: (v, r) => (r.usageReported ? <Num v={v as number} tone='lead' /> : quiet('—')),
  };
  const contextCol: ColumnDef<CallRow> = {
    field: 'contextTokens',
    header: 'Context',
    sortable: true,
    ...NUM_COL,
    renderCell: (v, r) => (r.usageReported ? <Num v={v as number} /> : quiet('—')),
  };
  const columns: Array<ColumnDef<CallRow>> = [
    {
      field: 'i',
      header: 'Call',
      sortable: true,
      className: 'whitespace-nowrap',
      renderCell: (_, r) => (
        <div className='leading-tight'>
          <div className='font-medium tabular-nums text-foreground'>#{r.i}</div>
          <div className='text-[11px] tabular-nums text-muted-foreground'>
            {formatTime(r.startedAt)}
          </div>
        </div>
      ),
    },
    {
      field: 'purpose',
      header: 'Purpose',
      sortable: true,
      minWidth: '11rem',
      renderCell: (_, r) => <PurposeCell r={r} />,
    },
    ...(showModel
      ? [
          {
            field: 'model',
            header: 'Model',
            sortable: true,
            renderCell: (_: unknown, r: CallRow): ReactElement => {
              const sub = [
                provider === null ? r.provider : null,
                r.servedModel && r.servedModel !== r.model ? `served ${r.servedModel}` : null,
              ].filter(Boolean);
              return (
                <div className='min-w-0 max-w-[12rem]'>
                  <div className='truncate text-foreground' title={r.model}>
                    {r.model}
                  </div>
                  {sub.length > 0 && (
                    <div className='truncate text-[11px] text-muted-foreground'>
                      {sub.join(' · ')}
                    </div>
                  )}
                </div>
              );
            },
          } satisfies ColumnDef<CallRow>,
        ]
      : []),
    ...(billing === null
      ? [
          {
            field: 'billing',
            header: 'Billing',
            sortable: true,
            className: 'whitespace-nowrap text-muted-foreground',
            renderCell: (v: unknown) => labelFor(BILLING_LABELS, v as string),
          } satisfies ColumnDef<CallRow>,
        ]
      : []),
    ...(metric === 'cost'
      ? [costCol, runningCol, ...TOKEN_CLASSES.map(tokenCol), contextCol]
      : [totalCol, ...TOKEN_CLASSES.map(tokenCol), contextCol, costCol, runningCol]),
  ];

  const exportCalls = (): Promise<void> => {
    downloadCsv(
      `ai-session-${conversationId}`,
      [
        'index',
        'started_at',
        'duration_ms',
        'run_id',
        'purpose',
        'subagent',
        'provider',
        'billing',
        'model',
        'served_model',
        'outcome',
        'usage_reported',
        'input_tokens',
        'output_tokens',
        'cache_read_tokens',
        'cache_write_tokens',
        'context_tokens',
        'cost_usd',
        'cumulative_cost_usd',
        'tools_read',
      ],
      rows.map(r => [
        r.i,
        r.startedAt,
        r.durationMs,
        r.runId,
        r.purpose,
        r.subagent,
        r.provider,
        r.billing,
        r.model,
        r.servedModel,
        r.outcome,
        r.usageReported,
        r.inputTokens,
        r.outputTokens,
        r.cacheReadTokens,
        r.cacheWriteTokens,
        r.contextTokens,
        r.costUsd,
        r.cumulativeCostUsd,
        r.toolNames.join(' '),
      ]),
    );
    return Promise.resolve();
  };

  return (
    <MetricsCard
      title='Calls'
      description='Every model call in order. Context is the prompt the call sent: new input plus cache reads and writes.'
      action={
        <>
          {shared.length > 0 && (
            <span
              className='inline-flex h-7 max-w-[20rem] items-center truncate rounded-full border border-border bg-muted/40 px-2.5 text-xs text-muted-foreground'
              title='Every call in this session shares these'
            >
              {shared.join(' · ')}
            </span>
          )}
          <ExportButton onExport={exportCalls} />
        </>
      }
    >
      <Table<CallRow>
        data={rows}
        columns={columns}
        idField='id'
        size='sm'
        sortable
        defaultSort={{ field: 'i', direction: 'asc' }}
        {...(rows.length > PAGE
          ? {
              pagination: { currentPage: page, pageSize: PAGE, totalRows: rows.length },
              onPageChange: setPage,
              pageSizeOptions: [PAGE],
            }
          : {})}
        rowClassName={r => cn(r.failed ? 'bg-destructive/5' : !r.usageReported && 'bg-warning/5')}
      />
    </MetricsCard>
  );
};

const ControlPanelSessionScreen = (): ReactElement => {
  const { conversationId } = useParams<{ conversationId: string }>();
  const cp = useControlPanel();
  const navigate = useNavigate();
  const location = useLocation();
  const session = useUsageSession(conversationId, cp.params.tz);
  const metric = cp.view.metric;

  const back = (): void => {
    if ((location.state as { fromList?: boolean } | null)?.fromList) {
      void navigate(-1);
      return;
    }
    const sp = new URLSearchParams(cp.search);
    sp.set('tab', 'sessions');
    void navigate(`/ai/control-panel?${sp.toString()}`);
  };

  const s = session.data;
  const notFound = session.error instanceof ClawApiError && session.error.status === 404;
  const peak = s ? s.calls.reduce((m, c) => Math.max(m, c.contextTokens), 0) : 0;
  const agents = s ? [...new Set(s.runs.map(r => r.agentSlug))].filter(Boolean) : [];
  const first = s?.calls[0];
  const last = s?.calls.at(-1);
  const subscription = s ? s.calls.filter(c => c.billing === 'subscription').length : 0;
  const wallMs =
    first && last ? Date.parse(last.startedAt) + last.durationMs - Date.parse(first.startedAt) : 0;
  const costTile = {
    label: 'Cost',
    value: <Num v={s?.totals.costUsd} fmt={formatUsd} />,
    detail:
      subscription > 0
        ? `excludes ${plural(subscription, 'subscription call')}`
        : s && s.totals.unpricedCalls > 0
          ? `${plural(s.totals.unpricedCalls, 'call')} not priced`
          : 'all calls priced',
  };
  const tokensTile = {
    label: 'Tokens',
    value: formatTokens(s?.totals.totalTokens),
    detail: `${formatTokens(s?.totals.outputTokens ?? 0)} output`,
  };
  const wall =
    wallMs >= 3_600_000
      ? `${(wallMs / 3_600_000).toFixed(1)} h`
      : wallMs >= 60_000
        ? `${Math.round(wallMs / 60_000)} min`
        : `${Math.round(wallMs / 1000)} s`;

  return (
    <div className='mx-auto w-full max-w-7xl px-6 py-8'>
      <PageHeader
        leading={
          <Button
            variant='outline'
            size='icon'
            aria-label='Back to sessions'
            title='Back to sessions'
            onClick={back}
            data-track-category={TRACK}
            data-track-name='session-back'
          >
            <ArrowLeft className='size-4' aria-hidden />
          </Button>
        }
        title={
          s ? (s.label ?? 'Untitled session') : notFound ? 'Session not found' : 'Loading session…'
        }
        subtitle={
          s && first ? (
            <span className='flex flex-wrap items-center gap-x-2 gap-y-1'>
              {agents.map(a => (
                <span key={a} className='font-medium text-foreground'>
                  <AgentChip slug={a} />
                </span>
              ))}
              <span>started {formatDateTime(first.startedAt)}</span>
              <span aria-hidden>·</span>
              <span>{plural(s.runs.length, 'run')}</span>
            </span>
          ) : (
            'Session usage'
          )
        }
        right={
          <SegmentedToggle
            options={METRIC_OPTIONS}
            value={metric}
            onChange={m => cp.update({ metric: m })}
            trackCategory={TRACK}
            trackPrefix='metric'
          />
        }
      />

      {notFound ? (
        <section className='rounded-xl border border-border bg-card p-5 shadow-sm'>
          <EmptyState
            title='No usage you can see for this session'
            detail='It may have no recorded model calls, or belong to someone else.'
          />
        </section>
      ) : session.isError ? (
        <section className='rounded-xl border border-border bg-card p-5 shadow-sm'>
          <ErrorState
            what='this session'
            error={session.error}
            onRetry={() => void session.refetch()}
          />
        </section>
      ) : !s ? (
        <div className='flex flex-col gap-5'>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5'>
            {[0, 1, 2, 3, 4].map(i => (
              <Skeleton key={i} className='h-[84px] w-full rounded-xl' />
            ))}
          </div>
          <Skeleton className='h-80 w-full rounded-xl' />
          <Skeleton className='h-72 w-full rounded-xl' />
        </div>
      ) : (
        <div className='flex flex-col gap-5'>
          <div className='grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5'>
            {(metric === 'cost' ? [costTile, tokensTile] : [tokensTile, costTile]).map(t => (
              <Tile key={t.label} {...t} />
            ))}
            <Tile
              label='Calls'
              value={formatTokens(s.totals.calls)}
              detail={plural(s.totals.runs, 'run')}
            />
            <Tile label='Peak context' value={formatTokens(peak)} detail='largest prompt sent' />
            <Tile label='Wall time' value={wall} detail='first call to last' />
          </div>

          {s.truncated && (
            <Banner tone='warn'>
              <strong className='font-semibold'>
                Showing the first {formatTokens(s.calls.length)} calls.
              </strong>{' '}
              This session has more; totals above cover only the calls shown.
            </Banner>
          )}

          <MetricsCard
            title='Call by call'
            description={
              metric === 'cost'
                ? 'The cost of each model call, with the running total.'
                : 'Each call’s tokens by class, with the running cost. Everything below output is the context the call sent.'
            }
          >
            <Timeline s={s} metric={metric} />
            <GrowthSummary s={s} />
          </MetricsCard>

          <CallsTable s={s} conversationId={s.conversationId} metric={metric} />
        </div>
      )}
    </div>
  );
};

export default ControlPanelSessionScreen;
