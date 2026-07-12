import { ReactElement, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Loader2,
  Minus,
  Search,
} from 'lucide-react';
import { Dialog } from '../../ui/Dialog';
import { cn } from '../../../utils/classNames';
import { formatDurationMs as formatMs } from '../../../utils/dateUtils';
import {
  overallPercent,
  type IngestionProgress,
  type FinishedTableEntry,
} from '../../../hooks/useIngestionProgress';

const ProgressRail = ({
  done,
  total,
  complete,
  errored,
}: {
  done: number;
  total: number;
  complete: boolean;
  errored: boolean;
}): ReactElement => {
  const pct = complete ? 1 : total > 0 ? done / total : 0;
  return (
    <div className='flex items-center gap-2'>
      {complete ? (
        <span className='w-3.5 h-3.5 rounded-full bg-emerald-500 flex items-center justify-center shrink-0'>
          <Check size={9} strokeWidth={3} className='text-white' />
        </span>
      ) : (
        <span
          className={cn(
            'w-3.5 h-3.5 rounded-full ring-2 ring-offset-1 ring-offset-white flex items-center justify-center shrink-0',
            errored ? 'bg-rose-500 ring-rose-200' : 'bg-indigo-500 ring-indigo-200',
          )}
        >
          {!errored && (
            <span className='w-1.5 h-1.5 rounded-full bg-white/90 animate-pulse motion-reduce:animate-none' />
          )}
        </span>
      )}
      <div className='flex-1 h-0.5 rounded-full bg-xyne-gray-100 overflow-hidden'>
        <div
          className={cn(
            'h-full rounded-full transition-[width] duration-500',
            complete ? 'bg-emerald-500' : errored ? 'bg-rose-400' : 'bg-indigo-400',
          )}
          style={{ width: `${Math.round(pct * 100)}%` }}
        />
      </div>
      <span className='text-[10px] font-mono tabular-nums leading-none text-xyne-gray-400 shrink-0 w-10 text-right'>
        {complete ? 'Done' : `${done}/${total || '—'}`}
      </span>
    </div>
  );
};

const StatChip = ({
  value,
  label,
  tone = 'neutral',
}: {
  value: string | number;
  label: string;
  tone?: 'neutral' | 'bad';
}): ReactElement => (
  <span
    className={cn(
      'inline-flex items-baseline gap-1 px-2 py-0.5 rounded-md text-[11px] border',
      tone === 'bad'
        ? 'bg-rose-50 border-rose-200 text-rose-700'
        : 'bg-xyne-gray-50 border-xyne-gray-200 text-xyne-gray-600',
    )}
  >
    <span className={cn('font-semibold tabular-nums', tone === 'bad' ? '' : 'text-xyne-gray-900')}>
      {value}
    </span>
    {label}
  </span>
);

const TableName = ({
  tableKey,
  grouped,
}: {
  tableKey: string;
  grouped?: boolean | undefined;
}): ReactElement => {
  const [schema, ...rest] = tableKey.split('.');
  const table = rest.join('.');
  return (
    <span className='truncate min-w-0'>
      {!grouped && <span className='text-xyne-gray-400'>{schema}.</span>}
      <span className='text-xyne-gray-900'>{table}</span>
    </span>
  );
};

const ProfiledRow = ({
  entry,
  grouped,
}: {
  entry: FinishedTableEntry;
  grouped?: boolean;
}): ReactElement => (
  <div className={`flex items-center gap-2 h-8 text-[13px] ${grouped ? 'pl-9 pr-3' : 'px-4'}`}>
    {entry.ok ? (
      <Check size={13} className='text-emerald-600 shrink-0' />
    ) : (
      <AlertCircle size={13} className='text-rose-600 shrink-0' />
    )}
    <TableName tableKey={entry.key} grouped={grouped} />
    {!entry.ok && entry.error && (
      <span className='truncate text-[11px] text-rose-600 min-w-0' title={entry.error}>
        {entry.error}
      </span>
    )}
    <span className='ml-auto flex items-center gap-2 shrink-0'>
      {grouped && (
        <span className='font-mono text-[11px] text-xyne-gray-400 tabular-nums'>
          {entry.columns} cols
        </span>
      )}
      <span className='font-mono text-[11px] text-xyne-gray-700 tabular-nums w-12 text-right'>
        {formatMs(entry.ms)}
      </span>
    </span>
  </div>
);

const SectionLabel = ({ children }: { children: React.ReactNode }): ReactElement => (
  <div className='px-5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-xyne-gray-400'>
    {children}
  </div>
);

const LIVE_VISIBLE_ROWS = 30;

function sliceLive<T extends { key: string }>(arr: ReadonlyArray<T>, filterNorm: string): T[] {
  const matched = filterNorm ? arr.filter(e => e.key.toLowerCase().includes(filterNorm)) : arr;
  return matched.slice(0, LIVE_VISIBLE_ROWS);
}

const LiveTicker = ({
  label,
  moreCount,
  moreWord,
  children,
}: {
  label: string;
  moreCount: number;
  moreWord: string;
  children: React.ReactNode;
}): ReactElement => (
  <div>
    <SectionLabel>{label}</SectionLabel>
    {children}
    {moreCount > 0 && (
      <div className='px-5 py-1.5 text-[11px] text-xyne-gray-400'>
        …and {moreCount} more {moreWord}
      </div>
    )}
  </div>
);

interface SchemaGroup {
  schema: string;
  entries: FinishedTableEntry[];
  totalMs: number;
}

export interface IngestionProgressDialogProps {
  open: boolean;
  onMinimize: () => void;
  onDismiss: () => void;
  progress: IngestionProgress;
}

export const IngestionProgressDialog = ({
  open,
  onMinimize,
  onDismiss,
  progress,
}: IngestionProgressDialogProps): ReactElement => {
  const [filter, setFilter] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const { total, done, failed, elapsedMs, finished, pending, status } = progress;
  const running = status === 'running';
  const filterNorm = filter.trim().toLowerCase();
  const overallPct = overallPercent(progress);

  const profileFailures = useMemo(() => finished.filter(f => !f.ok), [finished]);

  const groups = useMemo<SchemaGroup[]>(() => {
    if (running) return [];
    const bySchema = new Map<string, FinishedTableEntry[]>();
    for (const e of finished) {
      if (!e.ok) continue;
      if (filterNorm && !e.key.toLowerCase().includes(filterNorm)) continue;
      const schema = e.key.split('.')[0] ?? '';
      bySchema.set(schema, [...(bySchema.get(schema) ?? []), e]);
    }
    return [...bySchema.entries()]
      .map(([schema, entries]) => ({
        schema,
        entries: [...entries].sort((a, b) => b.ms - a.ms),
        totalMs: entries.reduce((s, e) => s + e.ms, 0),
      }))
      .sort((a, b) => b.totalMs - a.totalMs);
  }, [running, finished, filterNorm]);

  const toggleGroup = (schema: string): void =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(schema)) next.delete(schema);
      else next.add(schema);
      return next;
    });

  const liveProfile = useMemo(() => sliceLive(finished, filterNorm), [finished, filterNorm]);

  const title = running
    ? `Profiling ${progress.name ?? 'data source'}…`
    : status === 'complete'
      ? `${progress.name ?? 'Data source'} is ready`
      : status === 'partial'
        ? `${progress.name ?? 'Data source'} is ready — ${failed} table${failed === 1 ? '' : 's'} failed`
        : `Setting up ${progress.name ?? 'data source'} failed`;

  return (
    <Dialog
      open={open}
      onOpenChange={o => {
        if (!o) (running ? onMinimize : onDismiss)();
      }}
      title='Setting up data source'
      description='Profiling your tables'
      className='max-w-xl'
    >
      <div className='flex flex-col max-h-[80vh]'>
        <div className='px-5 pt-4 pb-3'>
          <div className='flex items-center gap-2'>
            {running && (
              <Loader2
                size={15}
                className='animate-spin motion-reduce:animate-none text-xyne-gray-500 shrink-0'
              />
            )}
            {status === 'complete' && (
              <CheckCircle2 size={16} className='text-emerald-600 shrink-0' />
            )}
            {status === 'partial' && (
              <AlertTriangle size={16} className='text-amber-500 shrink-0' />
            )}
            {status === 'error' && <AlertCircle size={16} className='text-rose-600 shrink-0' />}
            <h3 className='text-[15px] font-semibold text-xyne-gray-900 truncate'>{title}</h3>
            <span className='ml-auto font-mono text-[15px] tabular-nums text-xyne-gray-900 font-semibold shrink-0'>
              {overallPct}%
            </span>
          </div>
          <div className='mt-3.5 mb-1'>
            <ProgressRail
              done={done}
              total={total}
              complete={status === 'complete' || status === 'partial'}
              errored={status === 'error'}
            />
          </div>
          <div className='mt-3 flex items-center gap-1.5 flex-wrap'>
            <StatChip value={running ? `${done}/${total}` : total} label='tables' />
            {failed > 0 && <StatChip value={failed} label='failed' tone='bad' />}
            <StatChip value={formatMs(elapsedMs)} label='elapsed' />
          </div>
        </div>

        {(finished.length > 12 || filterNorm) && (
          <div className='px-5 py-2 border-b border-xyne-gray-100 shrink-0'>
            <div className='relative'>
              <Search
                size={13}
                className='absolute left-2.5 top-1/2 -translate-y-1/2 text-xyne-gray-400'
              />
              <input
                value={filter}
                onChange={e => setFilter(e.target.value)}
                placeholder='Filter tables…'
                data-track-category='DYNAMIC_DASHBOARD'
                data-track-name='Filter_Ingestion_Tables'
                className='w-full h-8 pl-8 pr-3 rounded-lg border border-xyne-gray-200 bg-white text-[13px] text-xyne-gray-900 placeholder:text-xyne-gray-400 outline-none focus:border-xyne-gray-400 transition-colors'
              />
            </div>
          </div>
        )}

        <div className='flex-1 min-h-0 overflow-y-auto py-1.5'>
          {running && finished.length === 0 && (
            <div className='px-5 py-6 text-[13px] text-xyne-gray-500 flex items-center gap-2'>
              <Loader2 size={14} className='animate-spin motion-reduce:animate-none' />
              {total > 0
                ? 'Reading catalog statistics…'
                : 'Waiting for the ingestion worker to start…'}
            </div>
          )}

          {profileFailures.length > 0 && (
            <div className='mb-1'>
              <div className='px-5 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-rose-600'>
                Failed · {profileFailures.length}
              </div>
              {profileFailures.map(e => (
                <ProfiledRow key={`pf-${e.key}`} entry={e} />
              ))}
            </div>
          )}

          {running && liveProfile.length > 0 && (
            <LiveTicker
              label='Just profiled'
              moreCount={done - liveProfile.length}
              moreWord='profiled'
            >
              {liveProfile
                .filter(e => e.ok)
                .map(e => (
                  <ProfiledRow key={e.key} entry={e} />
                ))}
            </LiveTicker>
          )}
          {running && pending.length > 0 && (
            <div className='px-5 py-2 text-[11px] text-xyne-gray-500 border-t border-xyne-gray-100 mt-1'>
              {pending.length} tables waiting
            </div>
          )}

          {!running &&
            groups.map(g => {
              const isOpen = expanded.has(g.schema) || !!filterNorm;
              return (
                <div key={g.schema}>
                  <button
                    type='button'
                    onClick={() => toggleGroup(g.schema)}
                    data-track-category='DYNAMIC_DASHBOARD'
                    data-track-name='Toggle_Ingestion_Schema_Group'
                    className='w-full flex items-center gap-2 px-4 h-9 text-[13px] hover:bg-xyne-gray-25 transition-colors'
                  >
                    {isOpen ? (
                      <ChevronDown size={13} className='text-xyne-gray-400 shrink-0' />
                    ) : (
                      <ChevronRight size={13} className='text-xyne-gray-400 shrink-0' />
                    )}
                    <span className='font-semibold text-xyne-gray-900'>{g.schema}</span>
                    <span className='text-[11px] text-xyne-gray-500'>
                      {g.entries.length} {g.entries.length === 1 ? 'table' : 'tables'}
                    </span>
                    <span className='ml-auto font-mono text-[11px] text-xyne-gray-500 tabular-nums'>
                      {formatMs(g.totalMs)}
                    </span>
                  </button>
                  {isOpen && g.entries.map(e => <ProfiledRow key={e.key} entry={e} grouped />)}
                </div>
              );
            })}
          {!running && groups.length === 0 && filterNorm && (
            <div className='px-5 py-6 text-[13px] text-xyne-gray-500'>
              No tables match “{filter.trim()}”.
            </div>
          )}
        </div>

        <div className='px-5 py-3 border-t border-xyne-gray-100 flex items-center gap-2 shrink-0'>
          {!running && status !== 'error' && (
            <span className='text-[12px] text-xyne-gray-500'>
              {done - failed} tables profiled in {formatMs(elapsedMs)}
              {failed > 0 ? ` · ${failed} failed` : ''}
            </span>
          )}
          {running ? (
            <button
              type='button'
              onClick={onMinimize}
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Minimize_Ingestion_Progress'
              className='ml-auto inline-flex items-center gap-1.5 px-3 h-8 rounded-lg text-[13px] font-medium text-xyne-gray-600 hover:bg-xyne-gray-100 transition-colors'
            >
              <Minus size={14} />
              Minimize
            </button>
          ) : (
            <button
              type='button'
              onClick={onDismiss}
              data-track-category='DYNAMIC_DASHBOARD'
              data-track-name='Close_Ingestion_Progress'
              className='ml-auto inline-flex items-center px-3 h-8 rounded-lg text-[13px] font-medium bg-xyne-gray-900 text-white hover:bg-xyne-gray-700 transition-colors'
            >
              Close
            </button>
          )}
        </div>
      </div>
    </Dialog>
  );
};
