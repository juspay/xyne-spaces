/* eslint-disable local-rules/require-tracking-on-click */
import { ReactElement, useState, useCallback, useMemo } from 'react';
import { useLogsQuery, type LogQueryParams } from './useInspector';
import { useAuth } from '../../hooks/useAuth';
import { usePlatform } from '../../hooks/usePlatform';
import { RefreshCw, Loader2, ChevronRight, ChevronDown, Copy, Check } from 'lucide-react';
import { getImportantFields, buildImportantEventsFilter, getFieldColor } from './logEventConfig';

type LogRecord = Record<string, unknown>;

// Fields shown as prefix badges in log rows (not in the key=value list)
const PREFIX_BADGE_FIELDS = new Set(['platformName', 'version']);

function getDefaultTimeRange(): { start: string; end: string } {
  const now = new Date();
  return {
    start: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    end: now.toISOString(),
  };
}

function getSeverityColor(level: string): string {
  switch (level?.toUpperCase()) {
    case 'ERROR':
    case 'FATAL':
    case 'CRITICAL':
      return 'text-red-700 dark:text-red-300';
    case 'WARN':
    case 'WARNING':
      return 'text-yellow-700 dark:text-yellow-400';
    case 'INFO':
      return 'text-emerald-600 dark:text-green-400';
    case 'DEBUG':
      return 'text-blue-700 dark:text-blue-400';
    default:
      return 'text-muted-foreground';
  }
}

function getStr(log: LogRecord, key: string): string {
  const v = log[key];
  return typeof v === 'string' ? v : '';
}

function getVal(log: LogRecord, key: string): string {
  const v = log[key];
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return JSON.stringify(v);
}

function formatTimeIST(isoTime: string): string {
  if (!isoTime) return '';
  try {
    return new Date(isoTime).toLocaleTimeString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  } catch {
    return isoTime.split('T')[1]?.slice(0, 12) || '';
  }
}

function QueryBadge({ query }: { query?: string | undefined }): ReactElement {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    if (!query) return;
    void navigator.clipboard.writeText(query).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [query]);

  if (!query) return <></>;

  return (
    <>
      <span
        className='text-sm font-mono text-muted-foreground bg-muted/30 px-3 py-1 rounded-md border border-border truncate max-w-[600px] inline-block select-text cursor-text'
        title={query}
      >
        <span className='text-muted-foreground/60'>query:</span>{' '}
        {query.length > 120 ? `${query.slice(0, 120)}...` : query}
      </span>
      <button
        type='button'
        onClick={handleCopy}
        className='shrink-0 p-1.5 rounded-md hover:bg-muted transition-colors'
        title='Copy query'
      >
        {copied ? (
          <Check size={12} className='text-green-500' />
        ) : (
          <Copy size={12} className='text-muted-foreground' />
        )}
      </button>
    </>
  );
}

function LogRow({ log }: { log: LogRecord }): ReactElement {
  const [expanded, setExpanded] = useState(false);

  const time = getStr(log, '_time');
  const lvl = getStr(log, 'level');
  const ctr = getStr(log, 'container');
  const platform = getStr(log, 'platformName');
  const version = getStr(log, 'version');

  const fields = getImportantFields(ctr);
  const compactParts: Array<{ field: string; val: string }> = [];
  for (const field of fields) {
    if (PREFIX_BADGE_FIELDS.has(field)) continue;
    const val = getVal(log, field);
    if (val) compactParts.push({ field, val });
  }

  return (
    <div className='border-b border-border/50'>
      <div
        onClick={() => setExpanded(!expanded)}
        role='button'
        tabIndex={0}
        onKeyDown={e => {
          if (e.key === 'Enter' || e.key === ' ') setExpanded(!expanded);
        }}
        className='w-full text-left font-mono text-sm px-2 py-1 hover:bg-muted/30 transition-colors cursor-pointer flex items-start gap-1 select-text'
      >
        <span className='shrink-0 mt-0.5 text-muted-foreground'>
          {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
        <span className='flex-1 min-w-0 break-all whitespace-pre-wrap'>
          <span className='text-muted-foreground'>{formatTimeIST(time)}</span>{' '}
          <span className={`font-semibold ${getSeverityColor(lvl)}`}>
            [{lvl.toUpperCase() || 'LOG'}]
          </span>{' '}
          {platform && (
            <>
              <span className='text-violet-700 dark:text-violet-400'>[{platform}]</span>{' '}
            </>
          )}
          {version && (
            <>
              <span className='text-amber-700 dark:text-amber-400'>[v{version}]</span>{' '}
            </>
          )}
          {compactParts.map((p, idx) => (
            <span key={p.field}>
              <span className='text-muted-foreground'>{p.field}=</span>
              <span className={getFieldColor(p.field, p.val)}>{p.val}</span>
              {idx < compactParts.length - 1 && '  '}
            </span>
          ))}
        </span>
      </div>
      {expanded && (
        <div className='ml-5 mb-1 px-3 py-2 bg-muted/20 rounded-md border border-border/50'>
          <pre className='font-mono text-sm text-foreground whitespace-pre-wrap break-all'>
            {JSON.stringify(log, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

function buildQueryParams(email?: string): LogQueryParams {
  const { start, end } = getDefaultTimeRange();
  return {
    startTime: start,
    endTime: end,
    email: email || undefined,
    container: 'xyne-logging-bridge',
    logsqlFilters: buildImportantEventsFilter(),
  };
}

type LevelFilter = 'all' | 'error' | 'warn' | 'info' | 'debug';

const LEVEL_FILTERS: Array<{ key: LevelFilter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'error', label: 'Error' },
  { key: 'warn', label: 'Warn' },
  { key: 'info', label: 'Info' },
  { key: 'debug', label: 'Debug' },
];

function matchesLevel(log: LogRecord, filter: LevelFilter): boolean {
  if (filter === 'all') return true;
  const lvl = getStr(log, 'level').toUpperCase();
  switch (filter) {
    case 'error':
      return lvl === 'ERROR' || lvl === 'FATAL' || lvl === 'CRITICAL';
    case 'warn':
      return lvl === 'WARN' || lvl === 'WARNING';
    case 'info':
      return lvl === 'INFO';
    case 'debug':
      return lvl === 'DEBUG';
    default:
      return true;
  }
}

export default function LogsTab(): ReactElement {
  const { user } = useAuth();
  const { isMobile } = usePlatform();

  const [email, setEmail] = useState(user?.email ?? '');
  const [levelFilter, setLevelFilter] = useState<LevelFilter>('all');
  const [queryParams, setQueryParams] = useState<LogQueryParams>(() =>
    buildQueryParams(user?.email),
  );
  const { data, isLoading, error } = useLogsQuery(queryParams);

  const logs = data?.raw_logs ?? [];
  const filteredLogs =
    levelFilter === 'all' ? logs : logs.filter(l => matchesLevel(l, levelFilter));

  const levelCounts = useMemo(() => {
    const counts: Record<LevelFilter, number> = {
      all: logs.length,
      error: 0,
      warn: 0,
      info: 0,
      debug: 0,
    };
    for (const log of logs) {
      const lvl = getStr(log, 'level').toUpperCase();
      if (lvl === 'ERROR' || lvl === 'FATAL' || lvl === 'CRITICAL') counts.error++;
      else if (lvl === 'WARN' || lvl === 'WARNING') counts.warn++;
      else if (lvl === 'INFO') counts.info++;
      else if (lvl === 'DEBUG') counts.debug++;
    }
    return counts;
  }, [logs]);

  const handleRefresh = useCallback(() => {
    setQueryParams(buildQueryParams(email || undefined));
  }, [email]);

  return (
    <div className='flex flex-col h-full'>
      {/* Toolbar: filters + query info + level filter */}
      <div className='flex flex-wrap items-center gap-4 px-4 py-2.5 border-b border-border bg-card/30'>
        <input
          type='text'
          placeholder='Email filter...'
          autoFocus={!isMobile}
          value={email}
          onChange={e => setEmail(e.target.value)}
          className='px-3.5 py-2 text-sm bg-background border border-border rounded-md w-56 focus:outline-none focus:ring-1 focus:ring-ring'
        />
        <button
          onClick={handleRefresh}
          disabled={isLoading}
          className='inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-primary text-primary-foreground rounded-md hover:bg-primary/90 disabled:opacity-50 transition-colors'
        >
          {isLoading ? <Loader2 size={14} className='animate-spin' /> : <RefreshCw size={14} />}
          Refresh
        </button>
        {data && (
          <>
            <span className='w-px h-5 bg-border' />
            <QueryBadge query={data.generated_logsql} />
            <span className='w-px h-5 bg-border' />
            <div className='inline-flex items-center gap-1'>
              {LEVEL_FILTERS.map(f => {
                const count = levelCounts[f.key];
                return (
                  <button
                    key={f.key}
                    onClick={() => setLevelFilter(f.key)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${
                      levelFilter === f.key
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                    }`}
                  >
                    {f.label}
                    {count > 0 && <span className='ml-1 opacity-70'>({count})</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Log results */}
      <div className='flex-1 overflow-auto p-3'>
        {error && (
          <div className='p-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md'>
            {error instanceof Error ? error.message : 'Failed to fetch logs'}
          </div>
        )}

        {data && (
          <div>
            {filteredLogs.map((log: LogRecord, i: number) => (
              <LogRow key={`${getStr(log, '_time')}-${i}`} log={log} />
            ))}
            {filteredLogs.length === 0 && (
              <div className='text-sm text-muted-foreground text-center py-8'>
                {logs.length > 0 ? 'No logs match the selected level.' : 'No logs found.'}
              </div>
            )}
          </div>
        )}

        {isLoading && !data && (
          <div className='flex items-center justify-center py-12 text-sm text-muted-foreground gap-2'>
            <Loader2 size={16} className='animate-spin' />
            Loading logs...
          </div>
        )}
      </div>
    </div>
  );
}
