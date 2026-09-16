import { v4 as uuidv4 } from 'uuid';
import { currentRouteTemplate } from '../../otel/perfMetrics';
import { logger, Event } from '../../../utils/logger';
import { diagnosticsStore } from '../store';
import { buildCheckContext, headlineFor, overallStatus, runChecks } from './checks';
import { clearReports, loadReports, saveReport } from './history';
import { runCpuBenchmark } from './probes/cpuBenchmark';
import { startEventLoopLagProbe } from './probes/eventLoopLag';
import { runStorageProbe } from './probes/storage';
import { RunWindow } from './window';
import { ENGINE_VERSION, type ProbeResults, type RunProgress, type RunReport } from './types';

/**
 * Orchestrates one diagnostic run.
 *
 * The shape is deliberately that of a Windows troubleshooter rather than a
 * monitor: the user starts it, it measures a bounded window, and it ends with a
 * verdict it can show its working for. Nothing about it is continuous and
 * nothing about it calls a model — every conclusion is derived on-device from
 * numbers printed in the report.
 *
 * Probes run *before* the observation window opens. They cost CPU, and a window
 * that contained its own benchmark would report the diagnostic as the fault.
 */

/** Long enough for a trend to mean something, short enough that a user waits for it. */
export const DEFAULT_OBSERVE_MS = 30_000;
export const MIN_OBSERVE_MS = 10_000;
export const MAX_OBSERVE_MS = 180_000;

const PROGRESS_TICK_MS = 250;

const IDLE_PROGRESS: RunProgress = {
  phase: 'idle',
  fraction: 0,
  label: '',
  secondsRemaining: null,
  error: null,
};

/** Probing is a small, roughly fixed slice; observing is the bulk of the wait. */
const PROBE_FRACTION = 0.12;
const OBSERVE_FRACTION = 0.85;

export interface RunState {
  progress: RunProgress;
  /** The run being displayed — the newest finished one unless the user picks another. */
  report: RunReport | null;
  reports: RunReport[];
}

class RunController {
  private state: RunState = { progress: IDLE_PROGRESS, report: null, reports: [] };
  private listeners = new Set<() => void>();
  private cancelled = false;
  private active = false;
  private ticker: ReturnType<typeof setInterval> | null = null;

  constructor() {
    const reports = loadReports();
    this.state = { progress: IDLE_PROGRESS, report: reports[0] ?? null, reports };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getSnapshot = (): RunState => this.state;

  get isRunning(): boolean {
    return this.active;
  }

  selectReport(id: string): void {
    const report = this.state.reports.find(candidate => candidate.id === id);
    if (report) this.setState({ report });
  }

  clearHistory(): void {
    clearReports();
    this.setState({ report: null, reports: [] });
  }

  cancel(): void {
    if (!this.active) return;
    this.cancelled = true;
  }

  async start(observeMs: number = DEFAULT_OBSERVE_MS): Promise<RunReport | null> {
    if (this.active) return null;
    this.active = true;
    this.cancelled = false;

    const duration = Math.min(MAX_OBSERVE_MS, Math.max(MIN_OBSERVE_MS, observeMs));
    const startedAt = Date.now();
    // Bound late: the window only exists once probing is done, and the handler
    // must point at the one actually being measured.
    let observationWindow: RunWindow | null = null;
    const onVisibilityChange = (): void => {
      if (document.hidden) observationWindow?.noteHidden();
    };

    try {
      this.publish({
        phase: 'preparing',
        fraction: 0.02,
        label: 'Getting ready',
        secondsRemaining: null,
        error: null,
      });

      // Probes first, and outside the window: a window containing its own
      // benchmark would attribute the diagnostic's cost to the app.
      this.publish({
        phase: 'probing',
        fraction: 0.05,
        label: 'Testing this machine',
        secondsRemaining: null,
        error: null,
      });
      const probes = await this.runProbes();
      if (this.cancelled) return this.finishCancelled();

      const windowStartedAt = Date.now();
      const measured = new RunWindow(windowStartedAt);
      observationWindow = measured;
      document.addEventListener('visibilitychange', onVisibilityChange);
      if (document.hidden) measured.noteHidden();

      diagnosticsStore.beginRunWindow(measured);
      const lagProbe = startEventLoopLagProbe();

      const completed = await this.observe(measured, windowStartedAt, duration);
      probes.eventLoop = lagProbe.stop();
      diagnosticsStore.endRunWindow();
      document.removeEventListener('visibilitychange', onVisibilityChange);

      if (!completed) return this.finishCancelled();

      this.publish({
        phase: 'analysing',
        fraction: 0.95,
        label: 'Working out what it means',
        secondsRemaining: null,
        error: null,
      });

      const report = this.analyse(measured, probes, startedAt);
      const reports = saveReport(report);
      this.setState({ report, reports });
      this.publish({
        phase: 'done',
        fraction: 1,
        label: 'Finished',
        secondsRemaining: null,
        error: null,
      });

      logger.info(Event.DIAGNOSTICS_RUN_COMPLETED, {
        overall: report.overall,
        durationMs: report.durationMs,
        failed: report.checks.filter(check => check.status === 'fail').length,
        warned: report.checks.filter(check => check.status === 'warn').length,
        skipped: report.checks.filter(check => check.status === 'skipped').length,
        route: report.route,
      });

      return report;
    } catch (error) {
      diagnosticsStore.endRunWindow();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      this.publish({
        phase: 'failed',
        fraction: 0,
        label: 'The run could not finish',
        secondsRemaining: null,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      this.stopTicker();
      this.active = false;
    }
  }

  /**
   * Probe failures are reported as missing measurements, not as a failed run.
   * A machine that cannot be benchmarked can still have its main thread and its
   * sync layer measured, and those are usually the answer anyway.
   */
  private async runProbes(): Promise<ProbeResults> {
    const [cpu, storage] = await Promise.all([
      runCpuBenchmark().catch(() => null),
      runStorageProbe().catch(() => null),
    ]);
    return { cpu, storage, eventLoop: null };
  }

  /** Resolves true when the window ran to completion, false when the user cancelled. */
  private observe(runWindow: RunWindow, startedAt: number, duration: number): Promise<boolean> {
    return new Promise(resolve => {
      this.ticker = setInterval(() => {
        const elapsed = Date.now() - startedAt;
        if (this.cancelled) {
          this.stopTicker();
          runWindow.close();
          resolve(false);
          return;
        }
        if (elapsed >= duration) {
          this.stopTicker();
          runWindow.close();
          resolve(true);
          return;
        }
        const progressed = elapsed / duration;
        this.publish({
          phase: 'observing',
          fraction: PROBE_FRACTION + progressed * (OBSERVE_FRACTION - PROBE_FRACTION),
          label: 'Watching the app',
          secondsRemaining: Math.ceil((duration - elapsed) / 1000),
          error: null,
        });
      }, PROGRESS_TICK_MS);
    });
  }

  private analyse(runWindow: RunWindow, probes: ProbeResults, startedAt: number): RunReport {
    const summary = runWindow.summarize();
    const snapshot = diagnosticsStore.getSnapshot();
    const context = buildCheckContext({
      window: summary,
      probes,
      cpu: snapshot.cpu,
      device: snapshot.device,
      zeroObserved: snapshot.zeroConnection.observingSince !== null,
    });

    const checks = runChecks(context);
    const overall = overallStatus(checks);
    const finishedAt = Date.now();

    return {
      id: uuidv4(),
      startedAt,
      finishedAt,
      durationMs: finishedAt - startedAt,
      engineVersion: ENGINE_VERSION,
      window: summary,
      probes,
      checks,
      overall,
      headline: headlineFor(checks, overall),
      device: snapshot.device,
      cpu: snapshot.cpu,
      route: currentRouteTemplate(),
      interactedDuringRun: summary.interactions > 0,
    };
  }

  private finishCancelled(): null {
    diagnosticsStore.endRunWindow();
    this.publish({
      phase: 'cancelled',
      fraction: 0,
      label: 'Stopped',
      secondsRemaining: null,
      error: null,
    });
    return null;
  }

  private stopTicker(): void {
    if (this.ticker === null) return;
    clearInterval(this.ticker);
    this.ticker = null;
  }

  private publish(progress: RunProgress): void {
    this.setState({ progress });
  }

  private setState(patch: Partial<RunState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }
}

export const runController = new RunController();
