import { Fragment, ReactElement, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type {
  GlobalMetricsAgentRow,
  GlobalMetricsProviderRow,
  SlowSession,
  ToolLatencyRow,
} from '@/services/claw/clawMetricsTypes';
import { cn } from '@/utils/classNames';
import { formatMs, formatPct } from './formatters';

const th = 'py-2 pr-3 text-xs font-medium uppercase tracking-wide text-muted-foreground';
const td = 'py-2.5 pr-3 text-sm text-foreground';

export const AgentLeaderboard = ({
  rows,
  onAgentClick,
}: {
  rows: GlobalMetricsAgentRow[];
  onAgentClick: (slug: string) => void;
}): ReactElement => {
  const { t } = useTranslation('common');
  const showOrg = rows.some(row => row.orgName || row.orgId);
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[680px]'>
        <thead>
          <tr className='text-left'>
            <th className={th}>{t('metricsTables.agentLeaderboard.agentHeader')}</th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.agentLeaderboard.runsHeader')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.agentLeaderboard.p50Header')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.agentLeaderboard.p95Header')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.agentLeaderboard.avgLlmHeader')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.agentLeaderboard.avgToolHeader')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.agentLeaderboard.errorsHeader')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={7} className='py-8 text-center text-sm text-muted-foreground'>
                {t('metricsTables.agentLeaderboard.noRuns')}
              </td>
            </tr>
          )}
          {rows.map(row => (
            <tr
              key={`${row.orgId ?? 'org'}:${row.agentSlug}`}
              className='cursor-pointer border-t border-border transition-colors hover:bg-muted/40'
              onClick={() => onAgentClick(row.agentSlug)}
              data-track-category='Claw Agents'
              data-track-name='Open agent metrics from leaderboard'
            >
              <td className={td}>
                <p className='font-medium'>{row.agentSlug}</p>
                {showOrg && (
                  <p className='text-xs text-muted-foreground'>
                    {row.orgName ?? row.orgId ?? t('metricsTables.agentLeaderboard.unknownOrg')}
                  </p>
                )}
              </td>
              <td className={cn(td, 'text-right tabular-nums')}>{row.runs}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.p50TotalMs)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.p95TotalMs)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.avgLlmMs)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.avgToolMs)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatPct(row.errorRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

type ProviderSort =
  | 'provider'
  | 'runs'
  | 'p50LlmMs'
  | 'p95LlmMs'
  | 'p50TtftMs'
  | 'avgTokensPerSec'
  | 'errorRate';

export const ProviderLatencyTable = ({
  rows,
}: {
  rows: GlobalMetricsProviderRow[];
}): ReactElement => {
  const { t } = useTranslation('common');
  const [sort, setSort] = useState<ProviderSort>('runs');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const sorted = useMemo(
    () =>
      [...rows].sort((a, b) => {
        const left = sort === 'provider' ? `${a.provider}:${a.model ?? ''}` : a[sort];
        const right = sort === 'provider' ? `${b.provider}:${b.model ?? ''}` : b[sort];
        if (typeof left === 'string' && typeof right === 'string') {
          return direction === 'asc' ? left.localeCompare(right) : right.localeCompare(left);
        }
        const leftNumber = left ?? (direction === 'asc' ? Infinity : -Infinity);
        const rightNumber = right ?? (direction === 'asc' ? Infinity : -Infinity);
        return direction === 'asc'
          ? Number(leftNumber) - Number(rightNumber)
          : Number(rightNumber) - Number(leftNumber);
      }),
    [rows, sort, direction],
  );
  const changeSort = (next: ProviderSort): void => {
    if (next === sort) setDirection(value => (value === 'asc' ? 'desc' : 'asc'));
    else {
      setSort(next);
      setDirection(next === 'provider' ? 'asc' : 'desc');
    }
  };
  const Header = ({ label, value }: { label: string; value: ProviderSort }): ReactElement => (
    <button
      type='button'
      onClick={() => changeSort(value)}
      data-track-category='Claw Agents'
      data-track-name='Sort provider metrics'
      className='inline-flex items-center gap-1 hover:text-foreground'
    >
      {label}{' '}
      <span className='text-[10px]'>
        {sort === value ? (direction === 'asc' ? '↑' : '↓') : '↕'}
      </span>
    </button>
  );

  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[820px]'>
        <thead>
          <tr className='text-left'>
            <th className={th}>
              <Header
                label={t('metricsTables.providerLatencyTable.providerModelHeader')}
                value='provider'
              />
            </th>
            <th className={cn(th, 'text-right')}>
              <Header label={t('metricsTables.providerLatencyTable.runsHeader')} value='runs' />
            </th>
            <th className={cn(th, 'text-right')}>
              <Header
                label={t('metricsTables.providerLatencyTable.p50LlmHeader')}
                value='p50LlmMs'
              />
            </th>
            <th className={cn(th, 'text-right')}>
              <Header
                label={t('metricsTables.providerLatencyTable.p95LlmHeader')}
                value='p95LlmMs'
              />
            </th>
            <th className={cn(th, 'text-right')}>
              <Header
                label={t('metricsTables.providerLatencyTable.p50TtftHeader')}
                value='p50TtftMs'
              />
            </th>
            <th className={cn(th, 'text-right')}>
              <Header
                label={t('metricsTables.providerLatencyTable.tpsHeader')}
                value='avgTokensPerSec'
              />
            </th>
            <th className={cn(th, 'text-right')}>
              <Header
                label={t('metricsTables.providerLatencyTable.errorPctHeader')}
                value='errorRate'
              />
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={7} className='py-8 text-center text-sm text-muted-foreground'>
                {t('metricsTables.providerLatencyTable.noProviderRuns')}
              </td>
            </tr>
          )}
          {sorted.map(row => (
            <tr
              key={`${row.provider}:${row.model ?? 'unknown'}`}
              className='border-t border-border'
            >
              <td className={td}>
                <p className='font-medium'>{row.provider}</p>
                <p className='font-mono text-xs text-muted-foreground'>
                  {row.model ?? t('metricsTables.providerLatencyTable.unknownModel')}
                </p>
              </td>
              <td className={cn(td, 'text-right tabular-nums')}>{row.runs}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.p50LlmMs)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.p95LlmMs)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.p50TtftMs)}</td>
              <td className={cn(td, 'text-right tabular-nums')}>
                {row.avgTokensPerSec === null ? '—' : Math.round(row.avgTokensPerSec)}
              </td>
              <td className={cn(td, 'text-right tabular-nums')}>{formatPct(row.errorRate)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

export const ToolLatencyTable = ({ rows }: { rows: ToolLatencyRow[] }): ReactElement => {
  const { t } = useTranslation('common');
  const total = rows.reduce((sum, row) => sum + row.totalMs, 0) || 1;
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[760px]'>
        <thead>
          <tr className='text-left'>
            <th className={th}>{t('metricsTables.toolLatencyTable.toolHeader')}</th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.toolLatencyTable.callsHeader')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.toolLatencyTable.avgHeader')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.toolLatencyTable.p50Header')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.toolLatencyTable.p95Header')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.toolLatencyTable.cumulativeHeader')}
            </th>
            <th className={th}>{t('metricsTables.toolLatencyTable.shareHeader')}</th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.toolLatencyTable.errorsHeader')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const share = row.totalMs / total;
            return (
              <tr key={row.tool} className='border-t border-border'>
                <td className={cn(td, 'font-mono text-xs', share >= 0.25 && 'text-amber-600')}>
                  {row.tool}
                </td>
                <td className={cn(td, 'text-right tabular-nums')}>{row.calls}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.avgMs)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.p50Ms)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.p95Ms)}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.totalMs)}</td>
                <td className={td}>
                  <div className='flex items-center gap-2'>
                    <div className='h-1.5 w-28 overflow-hidden rounded-full bg-muted'>
                      <div
                        className={cn(
                          'h-full rounded-full',
                          share >= 0.25 ? 'bg-amber-500' : 'bg-indigo-500',
                        )}
                        style={{ width: `${Math.max(2, share * 100)}%` }}
                      />
                    </div>
                    <span className='text-xs text-muted-foreground'>
                      {(share * 100).toFixed(1)}%
                    </span>
                  </div>
                </td>
                <td
                  className={cn(
                    td,
                    'text-right tabular-nums',
                    row.errors > 0 && 'text-destructive',
                  )}
                >
                  {row.errors || '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export const SlowSessionsTable = ({
  rows,
  showAgent,
}: {
  rows: SlowSession[];
  showAgent: boolean;
}): ReactElement => {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState<string | null>(null);
  return (
    <div className='overflow-x-auto'>
      <table className='w-full min-w-[740px]'>
        <thead>
          <tr className='text-left'>
            <th className={cn(th, 'w-8')} />
            <th className={th}>{t('metricsTables.slowSessionsTable.sessionHeader')}</th>
            {showAgent && (
              <th className={th}>{t('metricsTables.slowSessionsTable.agentHeader')}</th>
            )}
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.slowSessionsTable.totalHeader')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.slowSessionsTable.llmHeader')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.slowSessionsTable.toolHeader')}
            </th>
            <th className={cn(th, 'text-right')}>
              {t('metricsTables.slowSessionsTable.whenHeader')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row => {
            const open = expanded === row.sessionId;
            return (
              <Fragment key={row.sessionId}>
                <tr
                  className='cursor-pointer border-t border-border hover:bg-muted/40'
                  onClick={() => setExpanded(open ? null : row.sessionId)}
                  data-track-category='Claw Agents'
                  data-track-name='Expand slow session'
                >
                  <td className={td}>
                    {open ? (
                      <ChevronDown className='size-4' />
                    ) : (
                      <ChevronRight className='size-4' />
                    )}
                  </td>
                  <td className={cn(td, 'max-w-48 truncate font-mono text-xs')}>{row.sessionId}</td>
                  {showAgent && <td className={td}>{row.agentSlug}</td>}
                  <td className={cn(td, 'text-right font-medium tabular-nums')}>
                    {formatMs(row.totalMs)}
                  </td>
                  <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.llmTotalMs)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{formatMs(row.toolMs)}</td>
                  <td className={cn(td, 'text-right text-xs text-muted-foreground')}>
                    {new Date(row.completedAt).toLocaleString()}
                  </td>
                </tr>
                {open && (
                  <tr className='bg-muted/20'>
                    <td />
                    <td colSpan={showAgent ? 6 : 5} className='py-3 pr-3'>
                      {row.task && (
                        <p className='mb-3 text-xs text-muted-foreground'>
                          <span className='font-medium text-foreground'>
                            {t('metricsTables.slowSessionsTable.taskLabel')}
                          </span>
                          {row.task}
                        </p>
                      )}
                      {row.topTools.length === 0 ? (
                        <p className='text-xs text-muted-foreground'>
                          {t('metricsTables.slowSessionsTable.noToolCalls')}
                        </p>
                      ) : (
                        <div className='grid gap-1'>
                          {row.topTools.map(tool => (
                            <div
                              key={tool.tool}
                              className='grid grid-cols-[1fr_auto_auto] gap-4 rounded px-2 py-1 text-xs'
                            >
                              <span className='font-mono'>{tool.tool}</span>
                              <span>{formatMs(tool.ms)}</span>
                              <span>
                                {t('metricsTables.slowSessionsTable.callCount', {
                                  count: tool.calls,
                                })}
                                {tool.isError
                                  ? t('metricsTables.slowSessionsTable.errorSuffix')
                                  : ''}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
