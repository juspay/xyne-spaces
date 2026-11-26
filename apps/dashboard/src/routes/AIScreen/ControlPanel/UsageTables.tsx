import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DownloadDown,
  ExternalLinkSquare,
  MultipleCrossCancelDefault,
  SearchDefault,
} from '@xyne/icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Table, type ColumnDef, type SortState } from '@/components/ui/Table';
import { MetricsCard } from '@/components/ClawAgents/metrics/MetricsCard';
import UserAvatar, { AvatarShape, AvatarSize } from '@/components/UserAvatar/UserAvatar';
import { useAuth } from '@/hooks/useAuth';
import { useUsageBreakdown, useUsageTools } from '@/hooks/useClawUsage';
import {
  fetchAllBreakdownRows,
  type BreakdownRow,
  type BreakdownSort,
  type ToolUsageRow,
  type UsageOptions,
  type UsageTotals,
} from '@/services/claw/clawUsageService';
import { cn } from '@/utils/classNames';
import {
  AgentChip,
  BREAKDOWN_CSV_HEADERS,
  Banner,
  CopyableId,
  EmptyState,
  ErrorState,
  FILTER_KEYS,
  InlineSelect,
  LeadValue,
  NUM_COL,
  Num,
  PersonLabel,
  RelativeTime,
  TRACK,
  breakdownCsvRow,
  downloadCsv,
  formatUsd,
  plural,
  quiet,
  shareOf,
  type ControlPanel,
  type FilterKey,
  type Metric,
  type TableGroupBy,
} from './controlPanelShared';

const PAGE = 25;

const GROUP_OPTIONS: Array<{ value: TableGroupBy; label: string; adminOnly?: boolean }> = [
  { value: 'agent', label: 'Agent' },
  { value: 'user', label: 'User', adminOnly: true },
  { value: 'model', label: 'Model' },
  { value: 'provider', label: 'Provider' },
  { value: 'ticket', label: 'Ticket' },
  { value: 'pr', label: 'PR' },
];

const FILTER_FOR: Partial<Record<TableGroupBy, FilterKey>> = {
  agent: 'agents',
  user: 'users',
  model: 'models',
  provider: 'providers',
  ticket: 'tickets',
};

const FILTER_NOUN: Record<FilterKey, string> = {
  agents: 'Agent',
  users: 'User',
  models: 'Model',
  providers: 'Provider',
  tickets: 'Ticket',
};

/** After a row filters the page, the table breaks that row down by the next unfiltered one of these. */
const DRILL_ORDER: TableGroupBy[] = ['agent', 'user', 'model'];

const SERVER_SORTS = new Set<string>([
  'label',
  'costUsd',
  'totalTokens',
  'calls',
  'runs',
  'sessions',
  'lastAt',
]);

type Row = Record<string, unknown> &
  BreakdownRow & {
    id: string;
    agentLabel?: string;
  };

const toRow = (r: BreakdownRow): Row => ({ ...r, id: r.key || '__empty__' });

/** Same field toggles desc/asc; a new field starts desc, names asc. */
const nextSort = (current: SortState, field: string): { sort: string; dir: 'asc' | 'desc' } => ({
  sort: field,
  dir:
    current.field === field
      ? current.direction === 'desc'
        ? 'asc'
        : 'desc'
      : field === 'label' || field === 'tool'
        ? 'asc'
        : 'desc',
});

const NameCell = ({
  label,
  sub,
  lead,
}: {
  label: ReactNode;
  sub?: ReactNode;
  lead?: ReactNode;
}): ReactElement => (
  <div className='group/name flex min-w-0 max-w-[22rem] items-center gap-2'>
    {lead}
    <div className='min-w-0 flex-1'>
      <div className='truncate font-medium text-foreground'>{label}</div>
      {sub && <div className='truncate text-[11px] text-muted-foreground'>{sub}</div>}
    </div>
  </div>
);

const CostCell = ({
  r,
  metric,
  share,
}: {
  r: Row;
  metric: Metric;
  share: number | null;
}): ReactElement => {
  const value = <Num v={r.costUsd} fmt={formatUsd} tone={metric === 'cost' ? 'lead' : 'normal'} />;
  return (
    <div className='flex flex-col items-end'>
      {metric === 'cost' ? <LeadValue share={share}>{value}</LeadValue> : value}
      {r.unpricedCalls > 0 && (
        <span className='text-[11px] text-status-pending'>
          {plural(r.unpricedCalls, 'call')} not priced
        </span>
      )}
    </div>
  );
};

const SearchBox = ({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}): ReactElement => {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  useEffect(() => {
    if (text === value) return;
    const id = window.setTimeout(() => onChange(text), 300);
    return (): void => window.clearTimeout(id);
  }, [text, value, onChange]);
  return (
    <div className='relative w-full max-w-64'>
      <SearchDefault
        className='pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground'
        aria-hidden
      />
      <Input
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className='h-8 pl-8 text-xs'
        data-track-category={TRACK}
        data-track-name='table-search'
      />
    </div>
  );
};

export const ExportButton = ({ onExport }: { onExport: () => Promise<void> }): ReactElement => (
  <Button
    variant='outline'
    size='sm'
    trackAction={async () => {
      try {
        await onExport();
      } catch (e) {
        toast.error(e instanceof Error ? `Export failed: ${e.message}` : 'Export failed');
      }
    }}
    data-track-category={TRACK}
    data-track-name='export-csv'
  >
    <DownloadDown className='size-3.5' aria-hidden />
    Export CSV
  </Button>
);

const useNames = (
  options: UsageOptions | undefined,
): {
  agents: Map<string, string>;
  people: Map<string, { label: string; spacesUserId?: string; sublabel?: string | undefined }>;
} =>
  useMemo(() => {
    const users = options?.users ?? [];
    const seen = new Map<string, number>();
    for (const u of users) seen.set(u.label, (seen.get(u.label) ?? 0) + 1);
    return {
      agents: new Map((options?.agents ?? []).map(a => [a.key, a.label])),
      people: new Map(
        users.map(u => [
          u.key,
          {
            label: u.label,
            ...(u.spacesUserId ? { spacesUserId: u.spacesUserId } : {}),
            // Only when two people share a display name.
            sublabel:
              (seen.get(u.label) ?? 0) > 1 && u.sublabel !== u.label ? u.sublabel : undefined,
          },
        ]),
      ),
    };
  }, [options]);

const AppliedFilters = ({
  cp,
  options,
}: {
  cp: ControlPanel;
  options: UsageOptions | undefined;
}): ReactElement | null => {
  const { view, update } = cp;
  const { agents, people } = useNames(options);
  const chips = FILTER_KEYS.flatMap(k =>
    view[k].map(v => {
      const person = k === 'users' ? people.get(v) : undefined;
      const label =
        k === 'agents'
          ? (agents.get(v) ?? v)
          : person
            ? `${person.label}${person.sublabel ? ` · ${person.sublabel}` : ''}`
            : v;
      return { k, v, label };
    }),
  );
  if (chips.length === 0) return null;
  return (
    <div className='flex flex-wrap items-center gap-1.5' aria-label='Applied filters'>
      <span className='text-xs text-muted-foreground'>Filtered to</span>
      {chips.map(({ k, v, label }) => (
        <span
          key={`${k}:${v}`}
          className='inline-flex h-7 max-w-full items-center gap-1 rounded-full border border-action-accent/30 bg-action-accent/10 pl-2.5 pr-0.5 text-xs text-foreground'
        >
          <span className='shrink-0 text-muted-foreground'>{FILTER_NOUN[k]}:</span>
          <span className='max-w-[14rem] truncate font-medium'>{label}</span>
          <button
            type='button'
            aria-label={`Remove ${FILTER_NOUN[k].toLowerCase()} filter ${label}`}
            title='Remove'
            onClick={() => update({ [k]: view[k].filter(x => x !== v) }, { push: true })}
            data-track-category={TRACK}
            data-track-name={`filter-chip-remove-${k}`}
            className='inline-flex size-6 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-action-accent/20 hover:text-foreground'
          >
            <MultipleCrossCancelDefault className='size-3' aria-hidden />
          </button>
        </span>
      ))}
      {chips.length > 1 && (
        <button
          type='button'
          onClick={() => update(Object.fromEntries(FILTER_KEYS.map(k => [k, []])), { push: true })}
          data-track-category={TRACK}
          data-track-name='filter-clear-all'
          className='h-7 rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline'
        >
          Clear all
        </button>
      )}
    </div>
  );
};

const TableToolbar = ({
  cp,
  options,
  placeholder,
}: {
  cp: ControlPanel;
  options: UsageOptions | undefined;
  placeholder: string;
}): ReactElement => (
  <div className='flex flex-wrap items-center gap-x-4 gap-y-2'>
    <SearchBox
      value={cp.view.q}
      onChange={q => cp.update({ q, page: 1 })}
      placeholder={placeholder}
    />
    <AppliedFilters cp={cp} options={options} />
  </div>
);

export const BreakdownCard = ({
  cp,
  mode,
  isAdmin,
  options,
}: {
  cp: ControlPanel;
  mode: 'overview' | 'sessions';
  isAdmin: boolean;
  options: UsageOptions | undefined;
}): ReactElement => {
  const { view, update, params } = cp;
  const { user } = useAuth();
  const navigate = useNavigate();
  const metric = view.metric;
  const { agents: agentNames, people } = useNames(options);

  const groupBy: TableGroupBy =
    mode === 'sessions'
      ? 'session'
      : view.groupBy === 'session' || (!isAdmin && view.groupBy === 'user')
        ? 'agent'
        : view.groupBy;

  const defaultField = metric === 'cost' ? 'costUsd' : 'totalTokens';
  const sort: SortState = {
    field: view.sort ?? defaultField,
    direction: view.dir ?? (view.sort === 'label' ? 'asc' : 'desc'),
  };
  const serverSort = SERVER_SORTS.has(sort.field) ? (sort.field as BreakdownSort) : defaultField;

  const query = useUsageBreakdown(params, {
    groupBy,
    sort: serverSort,
    dir: sort.direction ?? 'desc',
    q: view.q || undefined,
    limit: PAGE,
    offset: (view.page - 1) * PAGE,
  });

  const rows = useMemo(
    () =>
      (query.data?.rows ?? []).map(r => {
        const row = toRow(r);
        if (r.agentSlug) row.agentLabel = agentNames.get(r.agentSlug) ?? r.agentSlug;
        return row;
      }),
    [query.data, agentNames],
  );
  const total = query.data?.total ?? 0;

  const nameLabel = GROUP_OPTIONS.find(o => o.value === groupBy)?.label ?? 'Session';
  const totals = query.data?.totals;
  /** A cell in the totals row; the row appears once the range totals have loaded. */
  const foot = (render: (t: UsageTotals) => ReactNode): Pick<ColumnDef<Row>, 'renderFooter'> =>
    totals ? { renderFooter: () => render(totals) } : {};
  const costCol: ColumnDef<Row> = {
    field: 'costUsd',
    header: 'Cost',
    sortable: true,
    ...NUM_COL,
    renderCell: (_, r) => (
      <CostCell r={r} metric={metric} share={shareOf(r.costUsd, totals?.costUsd)} />
    ),
    ...foot(t => (
      <Num v={t.costUsd} fmt={formatUsd} tone={metric === 'cost' ? 'lead' : 'normal'} />
    )),
  };
  const tokensCol: ColumnDef<Row> = {
    field: 'totalTokens',
    header: 'Tokens',
    sortable: true,
    ...NUM_COL,
    renderCell: (_, r) => {
      const value = <Num v={r.totalTokens} tone={metric === 'tokens' ? 'lead' : 'normal'} />;
      return metric === 'tokens' ? (
        <LeadValue share={shareOf(r.totalTokens, totals?.totalTokens)} width='min-w-[5.5rem]'>
          {value}
        </LeadValue>
      ) : (
        value
      );
    },
    ...foot(t => <Num v={t.totalTokens} tone={metric === 'tokens' ? 'lead' : 'normal'} />),
  };
  const pair = metric === 'cost' ? [costCol, tokensCol] : [tokensCol, costCol];
  const num = (
    field: string,
    header: string,
    sortable = SERVER_SORTS.has(field),
  ): ColumnDef<Row> => {
    const summed = (['calls', 'runs', 'sessions'] as const).find(k => k === field);
    return {
      field,
      header,
      sortable,
      ...NUM_COL,
      renderCell: v => <Num v={v as number | undefined} tone='muted' />,
      ...(summed ? foot(t => <Num v={t[summed]} />) : {}),
    };
  };
  const lastCol: ColumnDef<Row> = {
    field: 'lastAt',
    header: 'Last active',
    sortable: true,
    sortType: 'date',
    ...NUM_COL,
    renderCell: v => <RelativeTime iso={v as string} />,
  };

  const nameCol: ColumnDef<Row> = {
    field: 'label',
    header: nameLabel,
    sortable: true,
    minWidth: '14rem',
    ...foot(() => (
      <span className='whitespace-nowrap'>
        <span className='text-[11px] font-semibold uppercase tracking-wide'>Total in range</span>
        <span className='font-normal text-muted-foreground'>
          {' · '}
          {plural(total, groupBy === 'pr' ? 'PR' : nameLabel.toLowerCase())}
        </span>
      </span>
    )),
    renderCell: (_, r) => {
      if (groupBy === 'session') {
        const untitled = !r.key || r.label === r.key;
        return (
          <NameCell
            label={
              untitled ? (
                <span className='text-muted-foreground'>
                  {r.key ? 'Untitled session' : 'No session'}
                </span>
              ) : (
                r.label
              )
            }
            sub={r.key ? <CopyableId id={r.key} what='conversation id' /> : undefined}
          />
        );
      }
      if (groupBy === 'pr') {
        return (
          <div className='flex min-w-0 items-center gap-2'>
            <NameCell
              label={r.label}
              sub={
                (r.prsInSession ?? 1) > 1
                  ? `Shares its session's cost with ${r.prsInSession! - 1} other PR${r.prsInSession! > 2 ? 's' : ''}`
                  : r.prUrl
              }
            />
            {r.prStatus && (
              <Badge variant='outline' className='capitalize'>
                {r.prStatus}
              </Badge>
            )}
            {r.prUrl && (
              <ExternalLinkSquare className='size-3.5 shrink-0 text-muted-foreground' aria-hidden />
            )}
          </div>
        );
      }
      if (groupBy === 'agent' && r.key) {
        return (
          <div className='min-w-0 max-w-[22rem]'>
            <div className='font-medium text-foreground'>
              <AgentChip slug={r.key} label={r.label} />
            </div>
            {r.sublabel && r.sublabel !== r.label && (
              <div className='truncate pl-[1.625rem] text-[11px] text-muted-foreground'>
                {r.sublabel}
              </div>
            )}
          </div>
        );
      }
      return (
        <NameCell
          lead={
            groupBy === 'user' && r.spacesUserId ? (
              <UserAvatar
                userId={r.spacesUserId}
                size={AvatarSize.SM}
                shape={AvatarShape.CIRCULAR}
                showActiveStatus={false}
              />
            ) : undefined
          }
          label={r.label}
          sub={r.sublabel && r.sublabel !== r.label ? r.sublabel : undefined}
        />
      );
    },
  };

  const whoCol: ColumnDef<Row> = {
    field: 'agentLabel',
    header: isAdmin ? 'Agent · user' : 'Agent',
    sortable: false,
    ...foot(t => (
      <span className='text-[11px] font-normal text-muted-foreground'>
        {plural(t.agents, 'agent')}
        {isAdmin && ` · ${plural(t.users, 'user')}`}
      </span>
    )),
    renderCell: (_, r) => {
      const person = r.userId ? people.get(r.userId) : undefined;
      return (
        <div className='flex min-w-0 max-w-[14rem] flex-col gap-1'>
          {r.agentSlug ? (
            <span className='text-foreground'>
              <AgentChip slug={r.agentSlug} label={r.agentLabel} />
            </span>
          ) : (
            quiet('—')
          )}
          {isAdmin && r.userId && (
            <span className='text-[11px] text-muted-foreground'>
              <PersonLabel
                label={person?.label ?? r.userId}
                sublabel={person?.sublabel}
                spacesUserId={person?.spacesUserId}
              />
            </span>
          )}
        </div>
      );
    },
  };

  const columns: Array<ColumnDef<Row>> =
    groupBy === 'session'
      ? [
          nameCol,
          whoCol,
          ...pair,
          num('runs', 'Runs'),
          num('calls', 'Calls'),
          num('peakContextTokens', 'Peak context', false),
          lastCol,
        ]
      : [nameCol, ...pair, num('calls', 'Calls'), num('sessions', 'Sessions'), lastCol];

  const clickable = groupBy === 'session' || groupBy === 'pr' || !!FILTER_FOR[groupBy];
  const onRowClick = (r: Row): void => {
    // Rows still showing from the previous grouping would apply the wrong filter.
    if (query.isPlaceholderData) return;
    if (groupBy === 'session') {
      if (r.key) {
        void navigate(
          `/ai/control-panel/sessions/${encodeURIComponent(r.key)}${cp.search ? `?${cp.search}` : ''}`,
          { state: { fromList: true } },
        );
      }
      return;
    }
    if (groupBy === 'pr') {
      if (r.prUrl) window.open(r.prUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    const f = FILTER_FOR[groupBy];
    if (!f || !r.key) return;
    const filtered = { ...view, [f]: [...new Set([...view[f], r.key])] };
    const next = DRILL_ORDER.find(
      g => g !== groupBy && (isAdmin || g !== 'user') && filtered[FILTER_FOR[g]!].length === 0,
    );
    update({ [f]: filtered[f], ...(next ? { groupBy: next } : {}) }, { push: true });
  };

  const exportRows = async (): Promise<void> => {
    if (!user?.id) return;
    const all = await fetchAllBreakdownRows(user.id, params, {
      groupBy,
      sort: serverSort,
      dir: sort.direction ?? 'desc',
      q: view.q || undefined,
    });
    downloadCsv(
      `ai-usage-by-${groupBy}-${params.from}-to-${params.to}`,
      BREAKDOWN_CSV_HEADERS,
      all.map(breakdownCsvRow),
    );
  };

  return (
    <MetricsCard
      title={mode === 'sessions' ? 'Sessions' : 'Breakdown'}
      description={
        mode === 'sessions'
          ? 'Each chat or task thread. Open one to see how its cost grew call by call.'
          : groupBy === 'pr'
            ? 'Select a row to open the PR.'
            : 'Select a row to filter the page to it and break it down further.'
      }
      action={
        <>
          {mode === 'overview' && (
            <InlineSelect
              label='Group by'
              value={groupBy}
              options={GROUP_OPTIONS.filter(o => !o.adminOnly || isAdmin)}
              onChange={v => update({ groupBy: v })}
              track='table-group-by'
            />
          )}
          <ExportButton onExport={exportRows} />
        </>
      }
    >
      <div className='flex flex-col gap-3'>
        {groupBy === 'pr' && (
          <Banner tone='info'>
            A PR shows the full cost of the session it came from, so PRs opened from one session
            each show that session’s cost.
          </Banner>
        )}
        <TableToolbar
          cp={cp}
          options={options}
          placeholder={`Search ${groupBy === 'session' ? 'sessions' : nameLabel.toLowerCase() + 's'}…`}
        />
        <div className={cn('transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          <Table<Row>
            data={rows}
            columns={columns}
            idField='id'
            size='sm'
            sortable
            sort={sort}
            onSortChange={s => update({ ...nextSort(sort, s.field), page: 1 })}
            {...(total > PAGE
              ? {
                  pagination: { currentPage: view.page, pageSize: PAGE, totalRows: total },
                  serverSidePagination: true,
                  onPageChange: (page: number) => update({ page }),
                  pageSizeOptions: [PAGE],
                }
              : {})}
            {...(clickable ? { onRowClick } : {})}
            isLoading={query.data === undefined && !query.isError}
            skeletonRowCount={6}
            {...(query.isError && !query.data
              ? {
                  errorState: (
                    <ErrorState
                      what='this breakdown'
                      error={query.error}
                      onRetry={() => void query.refetch()}
                    />
                  ),
                }
              : {})}
            emptyState={
              view.q ? (
                <EmptyState title={`No matches for “${view.q}”`} />
              ) : (
                <EmptyState onClear={cp.activeFilterCount > 0 ? cp.clearFilters : undefined} />
              )
            }
          />
        </div>
      </div>
    </MetricsCard>
  );
};

type ToolRow = Record<string, unknown> & ToolUsageRow & { id: string };

export const ToolsCard = ({
  cp,
  options,
}: {
  cp: ControlPanel;
  options: UsageOptions | undefined;
}): ReactElement => {
  const { view, update } = cp;
  const query = useUsageTools(cp.params);
  const sort: SortState = {
    field: view.sort ?? 'soloContextTokens',
    direction: view.dir ?? (view.sort === 'tool' ? 'asc' : 'desc'),
  };
  const filtered = useMemo(() => {
    const needle = view.q.trim().toLowerCase();
    const rows = (query.data ?? []).map(r => ({ ...r, id: r.tool }) as ToolRow);
    return needle ? rows.filter(r => r.tool.toLowerCase().includes(needle)) : rows;
  }, [query.data, view.q]);
  const sorted = useMemo(() => {
    const dir = sort.direction === 'asc' ? 1 : -1;
    const f = sort.field;
    return [...filtered].sort((a, b) => {
      const av = a[f];
      const bv = b[f];
      const cmp =
        typeof av === 'string' ? av.localeCompare(String(bv)) : (av as number) - (bv as number);
      return cmp * dir || a.tool.localeCompare(b.tool);
    });
  }, [filtered, sort.field, sort.direction]);
  const shown = sorted.slice((view.page - 1) * PAGE, view.page * PAGE);
  const contextTotal = filtered.reduce((n, r) => n + r.soloContextTokens, 0);

  const num = (
    field: keyof ToolUsageRow,
    header: string,
    tone: 'normal' | 'muted',
  ): ColumnDef<ToolRow> => ({
    field,
    header,
    sortable: true,
    ...NUM_COL,
    renderCell: v => <Num v={v as number} tone={tone} />,
  });
  const columns: Array<ColumnDef<ToolRow>> = [
    {
      field: 'tool',
      header: 'Tool',
      sortable: true,
      minWidth: '14rem',
      renderCell: v => (
        <span className='font-mono text-xs font-medium text-foreground'>{v as string}</span>
      ),
    },
    {
      field: 'soloContextTokens',
      header: 'Context added',
      sortable: true,
      ...NUM_COL,
      renderCell: v => (
        <LeadValue share={shareOf(v as number, contextTotal)} width='min-w-[5.5rem]'>
          <Num v={v as number} tone='lead' />
        </LeadValue>
      ),
    },
    num('maxSoloContextTokens', 'Largest single read', 'normal'),
    num('soloCalls', 'Calls reading only this tool', 'muted'),
    num('sharedCalls', 'Calls reading several tools', 'muted'),
  ];

  const exportRows = (): Promise<void> => {
    downloadCsv(
      `ai-tool-context-${cp.params.from}-to-${cp.params.to}`,
      ['tool', 'solo_context_tokens', 'max_solo_context_tokens', 'solo_calls', 'shared_calls'],
      sorted.map(r => [
        r.tool,
        r.soloContextTokens,
        r.maxSoloContextTokens,
        r.soloCalls,
        r.sharedCalls,
      ]),
    );
    return Promise.resolve();
  };

  return (
    <MetricsCard
      title='Tools'
      description='How much each tool’s results grew the prompt of the next model call.'
      action={<ExportButton onExport={exportRows} />}
    >
      <div className='flex flex-col gap-3'>
        <Banner tone='info'>
          <strong className='font-semibold text-foreground'>
            Context added is exact only when a call read one tool’s results.
          </strong>{' '}
          It is the growth of that call’s prompt over the previous call’s prompt and reply. Calls
          that read several tools at once are counted, but their context is not split between the
          tools.
        </Banner>
        <TableToolbar cp={cp} options={options} placeholder='Search tools…' />
        <div className={cn('transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          <Table<ToolRow>
            data={shown}
            columns={columns}
            idField='id'
            size='sm'
            sortable
            sort={sort}
            onSortChange={s => update({ ...nextSort(sort, s.field), page: 1 })}
            {...(sorted.length > PAGE
              ? {
                  pagination: { currentPage: view.page, pageSize: PAGE, totalRows: sorted.length },
                  serverSidePagination: true,
                  onPageChange: (page: number) => update({ page }),
                  pageSizeOptions: [PAGE],
                }
              : {})}
            isLoading={query.data === undefined && !query.isError}
            {...(query.isError && !query.data
              ? {
                  errorState: (
                    <ErrorState
                      what='tool usage'
                      error={query.error}
                      onRetry={() => void query.refetch()}
                    />
                  ),
                }
              : {})}
            emptyState={
              view.q ? (
                <EmptyState title={`No tools match “${view.q}”`} />
              ) : (
                <EmptyState
                  title='No tool results were read in this range'
                  onClear={cp.activeFilterCount > 0 ? cp.clearFilters : undefined}
                />
              )
            }
          />
        </div>
      </div>
    </MetricsCard>
  );
};
