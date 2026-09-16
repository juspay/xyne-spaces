import { maxOf, mean, percentile } from '../stats';
import {
  gradeHigher,
  gradeLower,
  machineCaveat,
  measurement,
  ms,
  percent,
  samplesOf,
  seriesConfidence,
  skipped,
  values,
  worstStatus,
  type Check,
} from './shared';

/**
 * Checks for "the app freezes" — the complaint the whole panel exists to
 * explain. Each one measures a different way the main thread can fail a user,
 * because they have different fixes: sustained blocking, one catastrophic
 * block, fragmented blocking too small to register as a long task, and dropped
 * frames with no single culprit.
 */

/** Share of the window lost to long tasks. */
const BLOCKED_SHARE_WARN = 10;
const BLOCKED_SHARE_BAD = 25;
/** A single block this long reads as the app having hung, not as slowness. */
const LONGEST_BLOCK_WARN_MS = 500;
const LONGEST_BLOCK_BAD_MS = 1500;

const LAG_P95_WARN_MS = 100;
const LAG_P95_BAD_MS = 300;
const STALL_SHARE_WARN = 10;
const STALL_SHARE_BAD = 25;

const FPS_WARN = 45;
const FPS_BAD = 30;

/** A script owning at least this share of measured script time is worth naming. */
const DOMINANT_SCRIPT_SHARE = 0.35;
/** Forced style/layout above this share of a script's own time is the real fault. */
const LAYOUT_THRASH_SHARE = 0.3;
/** Below this there is not enough script time measured to apportion blame from. */
const MIN_ATTRIBUTABLE_MS = 150;

export const mainThreadBlocking: Check = context => {
  const { window } = context;
  if (window.durationMs <= 0) {
    return skipped(
      'main-thread-blocking',
      'Main thread blocking',
      'responsiveness',
      'The run window was empty.',
    );
  }

  const share = (window.blockedMs / window.durationMs) * 100;
  const status = worstStatus([
    gradeLower(share, BLOCKED_SHARE_WARN, BLOCKED_SHARE_BAD),
    gradeLower(window.longestBlockMs, LONGEST_BLOCK_WARN_MS, LONGEST_BLOCK_BAD_MS),
  ]);

  // Long tasks are individually observed events, not sampled ones, so the count
  // of them is the sample size — but an *absence* of them over a full window is
  // itself solid evidence, which a naive sample count would grade as low.
  const { confidence, reason } =
    status === 'pass' && window.durationMs >= 15_000
      ? {
          confidence: 'high' as const,
          reason: `Whole ${Math.round(window.durationMs / 1000)}s window observed continuously.`,
        }
      : seriesConfidence(context, window.longTasks.length, 3, 10);

  return {
    id: 'main-thread-blocking',
    title: 'Main thread blocking',
    category: 'responsiveness',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'The interface stayed responsive throughout the run.'
        : `The app was frozen for ${percent(share, 1)} of the run, with a longest freeze of ${ms(window.longestBlockMs)}.`,
    measurements: [
      measurement(
        'Time blocked',
        percent(share, 1),
        `warn ≥ ${BLOCKED_SHARE_WARN}%, fail ≥ ${BLOCKED_SHARE_BAD}%`,
      ),
      measurement(
        'Longest single freeze',
        ms(window.longestBlockMs),
        `warn ≥ ${LONGEST_BLOCK_WARN_MS}ms`,
      ),
      measurement('Long tasks', String(window.longTasks.length)),
      measurement('Total blocked', ms(window.blockedMs)),
    ],
    evidence: [
      `${window.longTasks.length} long task(s) totalling ${ms(window.blockedMs)} across a ${Math.round(window.durationMs / 1000)}s window`,
      ...machineCaveat(context),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Check which script is named below — sustained blocking with one dominant script is usually a single fixable hot path.',
    actionable: !context.loadIsExternal,
  };
};

export const inputResponsiveness: Check = context => {
  const lag = context.probes.eventLoop;
  if (!lag || lag.samples === 0) {
    return skipped(
      'input-responsiveness',
      'Input responsiveness',
      'responsiveness',
      'Event-loop timing was not collected for this run.',
    );
  }

  const status = worstStatus([
    gradeLower(lag.p95Ms, LAG_P95_WARN_MS, LAG_P95_BAD_MS),
    gradeLower(lag.stalledSharePercent, STALL_SHARE_WARN, STALL_SHARE_BAD),
  ]);
  const { confidence, reason } = seriesConfidence(context, lag.samples, 50, 150);

  return {
    id: 'input-responsiveness',
    title: 'Input responsiveness',
    category: 'responsiveness',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'Clicks and keystrokes would have been handled promptly.'
        : `A click during this run would have waited up to ${ms(lag.p95Ms)} before the app could react.`,
    measurements: [
      measurement('Delay (p95)', ms(lag.p95Ms), `warn ≥ ${LAG_P95_WARN_MS}ms`),
      measurement('Delay (median)', ms(lag.p50Ms)),
      measurement('Worst delay', ms(lag.maxMs)),
      measurement(
        'Stalled ticks',
        percent(lag.stalledSharePercent, 1),
        `warn ≥ ${STALL_SHARE_WARN}%`,
      ),
    ],
    evidence: [
      `Measured by timer drift over ${lag.samples} ticks, which catches blocking too fragmented to register as a long task`,
      ...(context.window.blockedMs === 0 && lag.p95Ms >= LAG_P95_WARN_MS
        ? [
            'No long tasks were recorded, so this delay comes from many small blocks rather than one large one',
          ]
        : []),
      ...machineCaveat(context),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Frequent small blocks usually mean work running on every render or every incoming update, rather than one slow function.',
    actionable: !context.loadIsExternal,
  };
};

export const frameRate: Check = context => {
  const samples = values(samplesOf(context, 'fps'));
  if (context.window.wasHidden) {
    return skipped(
      'frame-rate',
      'Frame rate',
      'responsiveness',
      'The window was hidden during the run, and a hidden tab is not given frames.',
    );
  }
  if (samples.length === 0) {
    return skipped('frame-rate', 'Frame rate', 'responsiveness', 'No frames were sampled.');
  }

  // The 5th percentile, not the mean: a user feels the worst seconds, and an
  // average comfortably hides a second-long stall inside thirty good seconds.
  const low = percentile(samples, 5) ?? 0;
  const average = mean(samples) ?? 0;
  const status = gradeHigher(low, FPS_WARN, FPS_BAD);
  const { confidence, reason } = seriesConfidence(context, samples.length, 10, 25);

  return {
    id: 'frame-rate',
    title: 'Frame rate',
    category: 'responsiveness',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'Scrolling and animation kept up throughout the run.'
        : `Frame rate dropped to ${low.toFixed(0)} fps at its worst, which reads as stuttering.`,
    measurements: [
      measurement(
        'Worst second (p5)',
        `${low.toFixed(0)} fps`,
        `warn ≤ ${FPS_WARN}, fail ≤ ${FPS_BAD}`,
      ),
      measurement('Average', `${average.toFixed(0)} fps`),
      measurement('Samples', String(samples.length)),
    ],
    evidence: [
      `Graded on the worst 5% of seconds rather than the average, since that is what a person notices`,
      ...(context.interactive
        ? []
        : ['Nobody interacted during this run, so the app was not being scrolled or typed into']),
      ...machineCaveat(context),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'If a script is named below, that is the cause. If not, the cost is spread across many small pieces of work.',
    actionable: !context.loadIsExternal,
  };
};

export const scriptAttribution: Check = context => {
  const { scripts, scriptTotalMs } = context.window;
  const worst = scripts[0];

  if (!worst || scriptTotalMs < MIN_ATTRIBUTABLE_MS) {
    return skipped(
      'script-attribution',
      'Slowest script',
      'responsiveness',
      scripts.length === 0
        ? 'This browser does not attribute main-thread time to scripts, or no slow frames occurred.'
        : 'Too little script time was measured to attribute it to anything.',
    );
  }

  const share = worst.totalMs / scriptTotalMs;
  const blockedShare = context.window.durationMs
    ? (context.window.blockedMs / context.window.durationMs) * 100
    : 0;
  const dominant = share >= DOMINANT_SCRIPT_SHARE;

  // Naming a script is only a *fault* when the app was actually blocked. A
  // dominant script in an otherwise responsive run is information, not a
  // problem, and reporting it as one is how a panel loses its credibility.
  const status = !dominant
    ? 'pass'
    : blockedShare >= BLOCKED_SHARE_BAD
      ? 'fail'
      : blockedShare >= BLOCKED_SHARE_WARN
        ? 'warn'
        : 'pass';

  const { confidence, reason } = seriesConfidence(context, worst.count, 3, 10);

  return {
    id: 'script-attribution',
    title: 'Slowest script',
    category: 'responsiveness',
    status,
    confidence,
    confidenceReason: reason,
    summary: dominant
      ? `${worst.fn} accounted for ${percent(share * 100)} of measured script time.`
      : `No single script dominated; the cost was spread across ${scripts.length} of them.`,
    measurements: [
      measurement('Function', worst.fn),
      measurement('Source', worst.source),
      measurement('Time used', ms(worst.totalMs)),
      measurement('Calls', String(worst.count)),
      measurement('Share of script time', percent(share * 100)),
    ],
    evidence: [
      `${worst.fn} in ${worst.source} used ${ms(worst.totalMs)} across ${worst.count} call(s)`,
      ...(worst.invoker ? [`Triggered by ${worst.invoker}`] : []),
      ...(dominant && status === 'pass'
        ? ['The app stayed responsive despite this, so it is context rather than a fault']
        : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Report this function name. A single dominant hot path is usually fixable on its own, unlike general slowness.',
    actionable: status !== 'pass',
  };
};

export const forcedLayout: Check = context => {
  const worst = [...context.window.scripts]
    .filter(script => script.totalMs > 0)
    .sort((a, b) => b.forcedLayoutMs - a.forcedLayoutMs)[0];

  if (!worst || worst.forcedLayoutMs <= 0) {
    return skipped(
      'forced-layout',
      'Layout recalculation',
      'responsiveness',
      'No forced style or layout work was attributed during the run.',
    );
  }

  const share = worst.forcedLayoutMs / worst.totalMs;
  const status = share >= LAYOUT_THRASH_SHARE && worst.forcedLayoutMs >= 50 ? 'warn' : 'pass';
  const { confidence, reason } = seriesConfidence(context, worst.count, 3, 10);

  return {
    id: 'forced-layout',
    title: 'Layout recalculation',
    category: 'responsiveness',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'Layout work stayed within normal bounds.'
        : `${worst.fn} spent ${percent(share * 100)} of its time forcing the browser to recalculate layout.`,
    measurements: [
      measurement('Function', worst.fn),
      measurement('Forced layout', ms(worst.forcedLayoutMs)),
      measurement('Of total', ms(worst.totalMs)),
      measurement('Share', percent(share * 100), `warn ≥ ${LAYOUT_THRASH_SHARE * 100}%`),
    ],
    evidence: [
      `${worst.fn} in ${worst.source} spent ${ms(worst.forcedLayoutMs)} of its ${ms(worst.totalMs)} on forced style and layout`,
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'This pattern is usually reading an element size inside a loop that also writes to it. Worth reporting with the function name.',
    actionable: status !== 'pass',
  };
};

export const navigationBlocking: Check = context => {
  const samples = values(samplesOf(context, 'navigationBlockingMs'));
  if (samples.length === 0) {
    return skipped(
      'navigation-blocking',
      'Screen opening',
      'responsiveness',
      'No screen was opened during the run.',
    );
  }

  const worst = maxOf(samples) ?? 0;
  const status = gradeLower(worst, 300, 1000);
  const { confidence, reason } = seriesConfidence(context, samples.length, 2, 4);

  return {
    id: 'navigation-blocking',
    title: 'Screen opening',
    category: 'responsiveness',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'Screens opened without freezing the app.'
        : `Opening a screen froze the app for up to ${ms(worst)}.`,
    measurements: [
      measurement('Worst freeze', ms(worst), 'warn ≥ 300ms, fail ≥ 1000ms'),
      measurement('Screens opened', String(samples.length)),
    ],
    evidence: [
      'Measures the interface being blocked, not data still loading — waiting on data is reported separately as query latency',
      ...machineCaveat(context),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Reproduce by opening the same screen again with the run active, so the script table below attributes it.',
    actionable: !context.loadIsExternal,
  };
};

export const RESPONSIVENESS_CHECKS: Check[] = [
  mainThreadBlocking,
  inputResponsiveness,
  frameRate,
  navigationBlocking,
  scriptAttribution,
  forcedLayout,
];
