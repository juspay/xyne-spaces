import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { MetricTile } from './MetricTile';
import { RunView } from './RunView';
import { runController } from '../../services/diagnostics/run';
import { buildRunJson, buildRunMarkdown } from '../../services/diagnostics/run/report';
import { useDiagnostics } from './useDiagnostics';
import { METRIC_SPECS, VERDICT_STYLES } from '../../services/diagnostics/thresholds';
import { buildReportJson, buildReportMarkdown, summarize } from '../../services/diagnostics/report';
import { clearHistory, diagnosticsStore, METRIC_KEYS } from '../../services/diagnostics';
import { askAiAboutPerformance } from '../../services/diagnostics/askAi';
import { analyze } from '../../services/diagnostics/rules';
import type { MetricSpec } from '../../services/diagnostics/thresholds';
import type {
  Finding,
  DiagnosticsSnapshot,
  ScriptDrain,
  Verdict,
  ZeroOpStat,
} from '../../services/diagnostics';

interface DiagnosticsPanelProps {
  onClose?: () => void;
  /**
   * Posts the report into the channel an automation watches. Supplied only
   * where a Zero client is in scope — the mobile overlay mounts above the
   * provider, so it omits this and the button simply does not render.
   */
  onRequestHelp?: (() => Promise<void>) | null;
}

// Live sync leads: it is the subsystem users actually feel, and the one the
// rest of the panel exists to explain.
const GROUPS: { group: MetricSpec['group']; title: string; blurb: string }[] = [
  {
    group: 'sync',
    title: 'Live sync',
    blurb: 'How quickly data loads, saves, and stays connected to the server.',
  },
  {
    group: 'cpu',
    title: 'CPU',
    blurb: 'How hard this machine is working, and how much of that is Xyne.',
  },
  { group: 'memory', title: 'Memory', blurb: 'How much memory the app is holding.' },
  {
    group: 'latency',
    title: 'Network',
    blurb: 'How long the app waits on the network.',
  },
];

type Tab = 'run' | 'live';

export function DiagnosticsPanel({ onClose, onRequestHelp }: DiagnosticsPanelProps): ReactElement {
  const [tab, setTab] = useState<Tab>('run');
  const [copied, setCopied] = useState<'markdown' | 'json' | null>(null);
  const [helpState, setHelpState] = useState<'idle' | 'sending' | 'sent' | 'failed'>('idle');

  // Read at click time rather than subscribing. The panel deliberately does not
  // re-render on every store notification: while a run is measuring, a panel
  // repainting four times a second is load inside the window it is measuring.
  const copy = useCallback(async (kind: 'markdown' | 'json') => {
    // A finished run is the better document: it is scoped to a window the user
    // can describe, where the session report spans everything since launch.
    const report = runController.getSnapshot().report;
    const snapshot = diagnosticsStore.getSnapshot();
    const text = report
      ? kind === 'markdown'
        ? buildRunMarkdown(report)
        : buildRunJson(report)
      : kind === 'markdown'
        ? buildReportMarkdown(snapshot)
        : buildReportJson(snapshot);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(kind);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // Clipboard blocked (insecure context or denied permission) — fall back
      // to a download so the user still has something to send to support.
      const blob = new Blob([text], {
        type: kind === 'markdown' ? 'text/markdown' : 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `xyne-performance-report.${kind === 'markdown' ? 'md' : 'json'}`;
      anchor.click();
      URL.revokeObjectURL(url);
    }
  }, []);

  const requestHelp = useCallback(async () => {
    if (!onRequestHelp) return;
    setHelpState('sending');
    try {
      await onRequestHelp();
      setHelpState('sent');
    } catch {
      // Surfaced in the button rather than thrown away, so a failed post does
      // not look like a successful one.
      setHelpState('failed');
    }
  }, [onRequestHelp]);

  const resetAll = useCallback(() => {
    diagnosticsStore.reset();
    runController.clearHistory();
    void clearHistory();
  }, []);

  return (
    <div className='flex h-full flex-col overflow-hidden border-l border-border bg-background text-foreground'>
      <header className='flex items-start justify-between gap-4 border-b border-border px-5 py-4'>
        <div className='min-w-0'>
          <h2 className='text-sm font-semibold'>Performance diagnostics</h2>
          <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>
            Measured on this device. Nothing is sent anywhere unless you export it.
          </p>
        </div>
        <div className='flex shrink-0 items-center gap-2'>
          <div
            className='flex overflow-hidden rounded-md border border-border'
            role='group'
            aria-label='View'
          >
            <TabButton current={tab} value='run' label='Diagnose' onSelect={setTab} />
            <TabButton current={tab} value='live' label='Live' onSelect={setTab} />
          </div>
          {onClose ? (
            <button
              type='button'
              onClick={onClose}
              data-track-category='Diagnostics'
              data-track-name='ClosePanel'
              className='rounded px-2 py-1 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
            >
              Close
            </button>
          ) : null}
        </div>
      </header>

      <div className='flex-1 overflow-y-auto'>
        {tab === 'run' ? <RunView /> : <LiveMetricsView />}
      </div>

      <footer className='flex flex-wrap items-center gap-2 border-t border-border px-5 py-3'>
        <button
          type='button'
          onClick={() => void copy('markdown')}
          data-track-category='Diagnostics'
          data-track-name='CopyReportMarkdown'
          className='rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
        >
          {copied === 'markdown' ? 'Copied' : 'Copy report'}
        </button>
        <button
          type='button'
          onClick={askAiAboutPerformance}
          data-track-category='Diagnostics'
          data-track-name='AskAi'
          className='rounded-md bg-neutral-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-neutral-700 dark:bg-neutral-100 dark:text-neutral-900 dark:hover:bg-neutral-300'
        >
          Ask AI about this
        </button>
        {onRequestHelp ? (
          <button
            type='button'
            onClick={() => void requestHelp()}
            disabled={helpState === 'sending'}
            data-track-category='Diagnostics'
            data-track-name='RequestHelp'
            className='rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 disabled:opacity-60 dark:border-neutral-700 dark:hover:bg-neutral-800'
          >
            {helpState === 'sending'
              ? 'Sending…'
              : helpState === 'sent'
                ? 'Sent for analysis'
                : helpState === 'failed'
                  ? 'Could not send — retry'
                  : 'Send to channel'}
          </button>
        ) : null}
        <button
          type='button'
          onClick={() => void copy('json')}
          data-track-category='Diagnostics'
          data-track-name='CopyReportJson'
          className='rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
        >
          {copied === 'json' ? 'Copied' : 'Copy raw data'}
        </button>
        <button
          type='button'
          onClick={resetAll}
          data-track-category='Diagnostics'
          data-track-name='ClearHistory'
          className='ml-auto rounded-md px-2 py-1.5 text-xs text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
        >
          Clear history
        </button>
      </footer>
    </div>
  );
}

interface TabButtonProps {
  current: Tab;
  value: Tab;
  label: string;
  onSelect: (value: Tab) => void;
}

function TabButton({ current, value, label, onSelect }: TabButtonProps): ReactElement {
  const active = current === value;
  return (
    <button
      type='button'
      onClick={() => onSelect(value)}
      aria-pressed={active}
      data-track-category='Diagnostics'
      data-track-name='SwitchTab'
      className={`px-2.5 py-1 text-xs ${
        active
          ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
          : 'hover:bg-neutral-100 dark:hover:bg-neutral-800'
      }`}
    >
      {label}
    </button>
  );
}

/**
 * The continuous view. Kept as its own component so the live subscription — and
 * the re-render it causes every 250ms — is mounted only while this tab is open.
 */
function LiveMetricsView(): ReactElement {
  const snapshot = useDiagnostics();
  const [range, setRange] = useState<'session' | 'history'>('session');

  const summary = useMemo(() => summarize(snapshot), [snapshot]);
  const findings = useMemo(() => analyze(snapshot), [snapshot]);
  const overall = VERDICT_STYLES[snapshot.overall];

  return (
    <div className='px-5 py-4'>
      <div className={`rounded-lg border p-4 ${overall.border} ${overall.bg}`}>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex items-center gap-2'>
            <span className={`h-2.5 w-2.5 rounded-full ${overall.dot}`} aria-hidden='true' />
            <span className={`text-sm font-semibold ${overall.text}`}>{overall.label}</span>
          </div>
          <div
            className='flex overflow-hidden rounded-md border border-border'
            role='group'
            aria-label='Trend range'
          >
            <RangeButton current={range} value='session' label='Session' onSelect={setRange} />
            <RangeButton current={range} value='history' label='24 hours' onSelect={setRange} />
          </div>
        </div>
        <p className='mt-1.5 text-sm text-neutral-700 dark:text-neutral-300'>{summary}</p>
        <MachineContext snapshot={snapshot} />
      </div>

      <Findings findings={findings} />
      <ConnectionHealth snapshot={snapshot} />

      {GROUPS.map(({ group, title, blurb }) => {
        const keys = METRIC_KEYS.filter(key => METRIC_SPECS[key].group === group);
        if (!keys.length) return null;
        return (
          <section key={group} className='mt-6'>
            <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
              {title}
            </h3>
            <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>{blurb}</p>
            <div className='mt-2.5 grid grid-cols-1 gap-2.5 xl:grid-cols-2'>
              {keys.map(key => (
                <MetricTile key={key} metric={snapshot.metrics[key]} range={range} />
              ))}
            </div>
          </section>
        );
      })}

      <ZeroOpTable
        rows={snapshot.zeroQueries}
        title='Slowest data requests'
        blurb='Each screen asks for data by name. A red row is the query making the app feel slow.'
        nameHeader='Query'
      />
      <ZeroOpTable
        rows={snapshot.zeroMutations}
        title='Slowest saves'
        blurb='Time until the server confirmed each action. Failures here mean work was lost or retried.'
        nameHeader='Action'
      />
      <DrainTable snapshot={snapshot} />
      <RequestTable snapshot={snapshot} />
      <ProcessTable snapshot={snapshot} />
    </div>
  );
}

interface RangeButtonProps {
  current: 'session' | 'history';
  value: 'session' | 'history';
  label: string;
  onSelect: (value: 'session' | 'history') => void;
}

function RangeButton({ current, value, label, onSelect }: RangeButtonProps): ReactElement {
  const active = current === value;
  return (
    <button
      type='button'
      onClick={() => onSelect(value)}
      aria-pressed={active}
      data-track-category='Diagnostics'
      data-track-name={value === 'session' ? 'RangeSession' : 'RangeHistory'}
      className={`px-2 py-1 text-xs ${
        active
          ? 'bg-neutral-900 text-white dark:bg-neutral-100 dark:text-neutral-900'
          : 'text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800'
      }`}
    >
      {label}
    </button>
  );
}

function MachineContext({ snapshot }: { snapshot: DiagnosticsSnapshot }): ReactElement | null {
  const { cpu, device } = snapshot;
  const parts: string[] = [];

  if (cpu.systemCpuPercent !== null) {
    parts.push(`Machine ${cpu.systemCpuPercent.toFixed(0)}% busy`);
  }
  if (cpu.appSharePercent !== null) {
    parts.push(`Xyne is ${cpu.appSharePercent.toFixed(0)}% of that`);
  }
  if (cpu.thermalState && cpu.thermalState !== 'unknown') {
    parts.push(`thermal ${cpu.thermalState}`);
  }
  if (device.hardwareConcurrency) parts.push(`${device.hardwareConcurrency} cores`);

  if (!parts.length) return null;
  return <p className='mt-2 text-xs text-neutral-500 dark:text-neutral-400'>{parts.join(' · ')}</p>;
}

/**
 * What the rules concluded. Sits above the measurements because a reader wants
 * the conclusion first — the numbers below are how it was reached.
 */
function Findings({ findings }: { findings: Finding[] }): ReactElement | null {
  if (!findings.length) return null;

  return (
    <section className='mt-6'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        What looks wrong
      </h3>
      <div className='mt-2.5 flex flex-col gap-2.5'>
        {findings.map(finding => {
          const style = VERDICT_STYLES[finding.severity];
          return (
            <div key={finding.id} className={`rounded-lg border p-3 ${style.border} ${style.bg}`}>
              <div className='flex items-start gap-2'>
                <span
                  className={`mt-1 h-2 w-2 shrink-0 rounded-full ${style.dot}`}
                  aria-hidden='true'
                />
                <div className='min-w-0'>
                  <p className={`text-sm font-medium ${style.text}`}>{finding.title}</p>
                  <ul className='mt-1.5 list-disc pl-4 text-xs text-neutral-600 dark:text-neutral-300'>
                    {finding.evidence.map(line => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                  <p className='mt-1.5 text-xs text-neutral-500 dark:text-neutral-400'>
                    {finding.suggestion}
                  </p>
                  {!finding.actionable ? (
                    <p className='mt-1 text-[11px] text-neutral-400 dark:text-neutral-500'>
                      Outside the app — nothing in Xyne will change this.
                    </p>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

const CONNECTION_LABELS: Record<string, string> = {
  connected: 'Connected',
  connecting: 'Reconnecting…',
  disconnected: 'Disconnected',
  // eslint-disable-next-line @typescript-eslint/naming-convention -- key comes from Zero's ConnectionState union
  'needs-auth': 'Session expired',
  error: 'Connection error',
  closed: 'Connection closed',
  unknown: 'Not started',
};

function connectionVerdict(snapshot: DiagnosticsSnapshot): Verdict {
  const { current, observingSince } = snapshot.zeroConnection;
  if (observingSince === null) return 'unknown';
  if (current === 'connected') return 'good';
  if (current === 'connecting') return 'warn';
  return 'bad';
}

function ConnectionHealth({ snapshot }: { snapshot: DiagnosticsSnapshot }): ReactElement | null {
  const zero = snapshot.zeroConnection;
  if (zero.observingSince === null) return null;

  const verdict = connectionVerdict(snapshot);
  const style = VERDICT_STYLES[verdict];

  return (
    <section className='mt-6'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        Connection
      </h3>

      <div className={`mt-2.5 rounded-lg border p-3 ${style.border} ${style.bg}`}>
        <div className='flex items-center gap-2'>
          <span className={`h-2 w-2 rounded-full ${style.dot}`} aria-hidden='true' />
          <span className={`text-sm font-medium ${style.text}`}>
            {CONNECTION_LABELS[zero.current] ?? zero.current}
          </span>
          {zero.currentReason ? (
            <span className='truncate text-xs text-neutral-500 dark:text-neutral-400'>
              {zero.currentReason}
            </span>
          ) : null}
        </div>
        <p className='mt-1.5 text-xs text-neutral-600 dark:text-neutral-300'>
          {zero.disconnects === 0
            ? 'No unexpected drops this session.'
            : `Dropped unexpectedly ${zero.disconnects} ${zero.disconnects === 1 ? 'time' : 'times'} in the last hour.`}
        </p>
        {zero.hiddenDisconnects > 0 ? (
          <p className='mt-1 text-[11px] text-neutral-500 dark:text-neutral-400'>
            Plus {zero.hiddenDisconnects} normal{' '}
            {zero.hiddenDisconnects === 1 ? 'disconnect' : 'disconnects'} from the tab being in the
            background. Expected, not a problem.
          </p>
        ) : null}
      </div>

      {zero.reasons.length ? (
        <div className='mt-2.5 overflow-x-auto'>
          <table className='w-full min-w-[360px] text-xs'>
            <thead className='text-left text-neutral-500 dark:text-neutral-400'>
              <tr>
                <th className='py-1.5 pr-3 font-medium'>Why it dropped</th>
                <th className='py-1.5 text-right font-medium'>Times</th>
              </tr>
            </thead>
            <tbody>
              {zero.reasons.slice(0, 6).map(row => (
                <tr
                  key={row.reason}
                  className='border-t border-neutral-100 dark:border-neutral-800'
                >
                  <td className='max-w-[420px] truncate py-1.5 pr-3'>{row.reason}</td>
                  <td className='py-1.5 text-right tabular-nums'>{row.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

interface ZeroOpTableProps {
  rows: ZeroOpStat[];
  title: string;
  blurb: string;
  nameHeader: string;
}

function ZeroOpTable({ rows, title, blurb, nameHeader }: ZeroOpTableProps): ReactElement | null {
  if (!rows.length) return null;

  return (
    <section className='mt-6'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        {title}
      </h3>
      <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>{blurb}</p>
      <div className='mt-2.5 overflow-x-auto'>
        <table className='w-full min-w-[520px] text-xs'>
          <thead className='text-left text-neutral-500 dark:text-neutral-400'>
            <tr>
              <th className='py-1.5 pr-3 font-medium'>{nameHeader}</th>
              <th className='py-1.5 pr-3 text-right font-medium'>Calls</th>
              <th className='py-1.5 pr-3 text-right font-medium'>p50</th>
              <th className='py-1.5 pr-3 text-right font-medium'>p95</th>
              <th className='py-1.5 pr-3 text-right font-medium'>Worst</th>
              <th className='py-1.5 text-right font-medium'>Failed</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 10).map(row => {
              const style = VERDICT_STYLES[row.verdict];
              return (
                <tr key={row.name} className='border-t border-neutral-100 dark:border-neutral-800'>
                  <td className='max-w-[220px] truncate py-1.5 pr-3'>
                    <span className='mr-1.5 inline-block align-middle'>
                      <span
                        className={`block h-2 w-2 rounded-full ${style.dot}`}
                        aria-hidden='true'
                      />
                    </span>
                    <span className='align-middle font-medium'>{row.name}</span>
                  </td>
                  <td className='py-1.5 pr-3 text-right tabular-nums'>{row.count}</td>
                  <td className='py-1.5 pr-3 text-right tabular-nums'>{row.p50Ms.toFixed(0)} ms</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${style.text}`}>
                    {row.p95Ms.toFixed(0)} ms
                  </td>
                  <td className='py-1.5 pr-3 text-right tabular-nums'>{row.maxMs.toFixed(0)} ms</td>
                  <td
                    className={`py-1.5 text-right tabular-nums ${
                      row.errors > 0 ? VERDICT_STYLES.bad.text : ''
                    }`}
                  >
                    {row.errors > 0 ? row.errors : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DrainTable({ snapshot }: { snapshot: DiagnosticsSnapshot }): ReactElement | null {
  if (!snapshot.scripts.length) return null;

  const total = snapshot.scripts.reduce((sum, script) => sum + script.totalMs, 0) || 1;

  return (
    <section className='mt-6'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        What is using the CPU
      </h3>
      <p className='mt-0.5 text-xs text-neutral-500 dark:text-neutral-400'>
        Real attribution from the browser, not an estimate. &ldquo;Triggered by&rdquo; is what
        started the work and stays readable in production builds; forced layout is the most
        expensive kind.
      </p>
      <div className='mt-2.5 overflow-x-auto'>
        <table className='w-full min-w-[520px] text-xs'>
          <thead className='text-left text-neutral-500 dark:text-neutral-400'>
            <tr>
              <th className='py-1.5 pr-3 font-medium'>Triggered by</th>
              <th className='py-1.5 pr-3 font-medium'>Source</th>
              <th className='py-1.5 pr-3 text-right font-medium'>Share</th>
              <th className='py-1.5 pr-3 text-right font-medium'>Total</th>
              <th className='py-1.5 text-right font-medium'>Forced layout</th>
            </tr>
          </thead>
          <tbody>
            {snapshot.scripts.slice(0, 10).map(script => (
              <tr
                key={`${script.source}:${script.fn}`}
                className='border-t border-neutral-100 dark:border-neutral-800'
              >
                <td className='max-w-[220px] truncate py-1.5 pr-3 font-medium'>
                  {describeScript(script)}
                </td>
                <td className='max-w-[200px] truncate py-1.5 pr-3 text-neutral-500 dark:text-neutral-400'>
                  {script.source}
                </td>
                <td className='py-1.5 pr-3 text-right tabular-nums'>
                  {((script.totalMs / total) * 100).toFixed(0)}%
                </td>
                <td className='py-1.5 pr-3 text-right tabular-nums'>
                  {script.totalMs.toFixed(0)} ms
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {script.forcedLayoutMs > 0 ? `${script.forcedLayoutMs.toFixed(0)} ms` : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/**
 * Production bundles are minified, so `sourceFunctionName` is often a one- or
 * two-character identifier that tells a reader nothing. LoAF also reports the
 * *invoker* — the event listener, timer or framework callback that started the
 * work — and that string is built from DOM and API names, so it survives
 * minification intact. Prefer it whenever the function name is unusable.
 */
function describeScript(script: ScriptDrain): string {
  const fn = script.fn;
  const meaningless = fn === '(anonymous)' || /^[$_a-z]{1,3}\d*$/i.test(fn);
  if (meaningless && script.invoker) return script.invoker;
  if (script.invoker && script.invoker !== fn) return `${fn} · ${script.invoker}`;
  return fn;
}

function RequestTable({ snapshot }: { snapshot: DiagnosticsSnapshot }): ReactElement | null {
  if (!snapshot.api.length) return null;

  const slowest = [...snapshot.api].sort((a, b) => b.p95Ms - a.p95Ms).slice(0, 10);

  return (
    <section className='mt-6'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        Slowest requests
      </h3>
      <div className='mt-2.5 overflow-x-auto'>
        <table className='w-full min-w-[480px] text-xs'>
          <thead className='text-left text-neutral-500 dark:text-neutral-400'>
            <tr>
              <th className='py-1.5 pr-3 font-medium'>Endpoint</th>
              <th className='py-1.5 pr-3 text-right font-medium'>Calls</th>
              <th className='py-1.5 pr-3 text-right font-medium'>p95</th>
              <th className='py-1.5 text-right font-medium'>Transferred</th>
            </tr>
          </thead>
          <tbody>
            {slowest.map(row => (
              <tr
                key={row.endpoint}
                className='border-t border-neutral-100 dark:border-neutral-800'
              >
                <td className='max-w-[260px] truncate py-1.5 pr-3'>{row.endpoint}</td>
                <td className='py-1.5 pr-3 text-right tabular-nums'>{row.count}</td>
                <td className='py-1.5 pr-3 text-right tabular-nums'>{row.p95Ms.toFixed(0)} ms</td>
                <td className='py-1.5 text-right tabular-nums'>{row.transferKb.toFixed(0)} KB</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ProcessTable({ snapshot }: { snapshot: DiagnosticsSnapshot }): ReactElement | null {
  if (!snapshot.electron?.length) return null;

  const processes = [...snapshot.electron].sort((a, b) => b.cpuPercent - a.cpuPercent).slice(0, 8);

  return (
    <section className='mt-6'>
      <h3 className='text-xs font-semibold uppercase tracking-wide text-neutral-500 dark:text-neutral-400'>
        Processes
      </h3>
      <div className='mt-2.5 overflow-x-auto'>
        <table className='w-full min-w-[420px] text-xs'>
          <thead className='text-left text-neutral-500 dark:text-neutral-400'>
            <tr>
              <th className='py-1.5 pr-3 font-medium'>Process</th>
              <th className='py-1.5 pr-3 text-right font-medium'>CPU</th>
              <th className='py-1.5 text-right font-medium'>Memory</th>
            </tr>
          </thead>
          <tbody>
            {processes.map(process => (
              <tr key={process.pid} className='border-t border-neutral-100 dark:border-neutral-800'>
                <td className='py-1.5 pr-3'>
                  {process.name}
                  <span className='ml-1 text-neutral-400'>({process.type})</span>
                </td>
                <td className='py-1.5 pr-3 text-right tabular-nums'>
                  {process.cpuPercent.toFixed(0)}%
                </td>
                <td className='py-1.5 text-right tabular-nums'>
                  {process.workingSetMb.toFixed(0)} MB
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
