import { maxOf, mean, percentile } from '../stats';
import {
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
/** Share of seconds that must be affected before stutter is a finding rather than a blip. */
const POOR_SECOND_SHARE = 20;
const BAD_SECOND_SHARE = 10;

/** A script owning at least this share of measured script time is worth naming. */
const DOMINANT_SCRIPT_SHARE = 0.35;
/** A single function holding this share of sampled thread time is the story. */
const DOMINANT_SELF_SHARE = 25;
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

  // Graded on how *much* of the run was bad, not on its worst instant. A single
  // dropped second is normal — one legitimate burst of work would otherwise
  // fail the check on every run and teach the reader to ignore it. What a person
  // actually notices is stutter that persists.
  const badSeconds = samples.filter(value => value < FPS_BAD).length;
  const poorSeconds = samples.filter(value => value < FPS_WARN).length;
  const badShare = (badSeconds / samples.length) * 100;
  const poorShare = (poorSeconds / samples.length) * 100;
  const low = percentile(samples, 5) ?? 0;
  const average = mean(samples) ?? 0;
  const status =
    badShare >= BAD_SECOND_SHARE ? 'fail' : poorShare >= POOR_SECOND_SHARE ? 'warn' : 'pass';
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
        : `${poorSeconds} of ${samples.length} seconds dropped below ${FPS_WARN} fps, which reads as stuttering.`,
    measurements: [
      measurement(
        'Seconds below 30 fps',
        `${badSeconds} of ${samples.length}`,
        `fail ≥ ${BAD_SECOND_SHARE}% of the run`,
      ),
      measurement(
        'Seconds below 45 fps',
        `${poorSeconds} of ${samples.length}`,
        `warn ≥ ${POOR_SECOND_SHARE}% of the run`,
      ),
      measurement('Worst second', `${low.toFixed(0)} fps`),
      measurement('Average', `${average.toFixed(0)} fps`),
    ],
    evidence: [
      'Graded on how much of the run stuttered rather than on its worst instant, since one dropped second is normal',
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

/**
 * Names what the main thread was actually inside.
 *
 * This is the check the rest of the responsiveness section exists to set up.
 * `mainThreadBlocking` says the thread was unavailable and `scriptAttribution`
 * says which callback entered the script — but for anything React renders that
 * callback is always the scheduler, so neither can name the code responsible.
 * Only the sampling profiler can, because it captures the whole stack rather
 * than its entry point.
 */
export const mainThreadAttribution: Check = context => {
  const attribution = context.probes.mainThread;

  if (!attribution || !attribution.supported) {
    return skipped(
      'main-thread-attribution',
      'Where the time went',
      'responsiveness',
      attribution?.unsupportedReason || 'Main-thread attribution was not collected for this run.',
    );
  }

  // The app's own code leads. A ranking by raw self time on a React app is a
  // ranking of React's internals, which is true and useless — the thread is
  // almost never inside app code at the instant it is sampled.
  const appFrames = attribution.appFrames ?? [];
  const rawFrames = attribution.frames ?? [];
  const top = appFrames[0] ?? rawFrames[0];
  const attributedToApp = appFrames.length > 0;
  if (!top || attribution.busyMs <= 0) {
    return {
      id: 'main-thread-attribution',
      title: 'Where the time went',
      category: 'responsiveness',
      status: 'pass',
      confidence: attribution.samples > 100 ? 'high' : 'low',
      confidenceReason: `${attribution.samples} samples at ${attribution.sampleIntervalMs}ms.`,
      summary: 'The main thread was idle for essentially the whole run.',
      measurements: [
        measurement('Thread busy', percent(0)),
        measurement('Samples', String(attribution.samples)),
      ],
      evidence: ['Nothing was running long enough to be sampled'],
      remediation: '',
      actionable: false,
    };
  }

  const busySharePercent = attribution.durationMs
    ? (attribution.busyMs / attribution.durationMs) * 100
    : 0;
  const blockedShare = context.window.durationMs
    ? (context.window.blockedMs / context.window.durationMs) * 100
    : 0;
  const dominant = top.selfSharePercent >= DOMINANT_SELF_SHARE;

  // Naming the busiest function is always useful; calling it a *fault* requires
  // the thread to have actually been under pressure. The heaviest function in a
  // responsive run is just the app doing its job.
  const status = !dominant
    ? 'pass'
    : blockedShare >= BLOCKED_SHARE_BAD
      ? 'fail'
      : blockedShare >= BLOCKED_SHARE_WARN
        ? 'warn'
        : 'pass';

  const { confidence, reason } = seriesConfidence(context, attribution.busySamples, 50, 200);
  const component = (attribution.components ?? [])[0];
  const devNote = attribution.devBuild
    ? ' Measured against a development build, which does substantially more work per render than the one users run.'
    : '';
  // A truncated sample still describes real execution, but only of the stretch
  // it covered — so it must not be read as a picture of the whole run.
  const truncationNote = attribution.truncated
    ? ` Sampling filled its buffer and stopped after ${Math.round(attribution.durationMs / 1000)}s, so this covers only the first part of the run.`
    : '';
  const where = top.resource
    ? `${top.resource}${top.line === null ? '' : `:${top.line}`}`
    : 'an unknown source';

  return {
    id: 'main-thread-attribution',
    title: 'Where the time went',
    category: 'responsiveness',
    status,
    confidence: attribution.truncated && confidence === 'high' ? 'medium' : confidence,
    confidenceReason: `${reason} Sampled every ${attribution.sampleIntervalMs}ms.${truncationNote}${devNote}`,
    summary: dominant
      ? `${top.name} accounts for ${ms(top.selfMs)} of main-thread time — ${percent(top.selfSharePercent)} of everything the thread did.`
      : `No single function dominated; ${top.name} was the largest at ${percent(top.selfSharePercent)}.`,
    measurements: [
      measurement('Busiest function', top.name, describeKind(top.kind)),
      measurement(
        'Its own time',
        ms(top.selfMs),
        `${percent(top.selfSharePercent)} of thread time`,
      ),
      measurement('Including what it called', ms(top.totalMs)),
      measurement('Defined in', where),
      ...(component
        ? [
            measurement(
              'Heaviest component',
              component.name,
              `${ms(component.totalMs)} including children`,
            ),
          ]
        : []),
      measurement('Thread busy', percent(busySharePercent)),
    ],
    evidence: [
      ...(attributedToApp
        ? [
            'Each sample is charged to the deepest function of yours on the stack, so React\u2019s render and commit work counts against whichever component caused it',
          ]
        : [
            'No application frames were identifiable in the samples, so these are raw stack leaves — mostly framework internals',
          ]),
      ...(attributedToApp ? appFrames : rawFrames)
        .slice(0, 5)
        .map(
          frame =>
            `${frame.name} — ${ms(frame.selfMs)}${attributedToApp ? ' charged' : ' own time'}, ${ms(frame.totalMs)} including calls${frame.resource ? ` (${frame.resource}${frame.line === null ? '' : `:${frame.line}`})` : ''}`,
        ),
      ...((attribution.frameworkOnlyMs ?? 0) > 0
        ? [
            `${ms(attribution.frameworkOnlyMs ?? 0)} could not be charged to any app frame — framework work with nothing of yours beneath it`,
          ]
        : []),
      ...(attribution.hotPath.length > 1
        ? [`Heaviest call path: ${attribution.hotPath.map(step => step.name).join(' → ')}`]
        : []),
      ...(top.selfMs * 4 < top.totalMs
        ? [
            `${top.name} spends most of its time in what it calls rather than its own code, so the cost is below it`,
          ]
        : []),
      ...machineCaveat(context),
    ],
    remediation:
      status === 'pass'
        ? ''
        : `Report ${top.name}${component ? ` and ${component.name}` : ''} with this report. This is a measured call stack, not an inference.`,
    actionable: status !== 'pass',
  };
};

function describeKind(kind: 'component' | 'hook' | 'function' | 'anonymous'): string {
  switch (kind) {
    case 'component':
      return 'looks like a React component';
    case 'hook':
      return 'looks like a hook';
    case 'anonymous':
      return 'unnamed function';
    default:
      return 'function';
  }
}

export const RESPONSIVENESS_CHECKS: Check[] = [
  mainThreadBlocking,
  mainThreadAttribution,
  inputResponsiveness,
  frameRate,
  navigationBlocking,
  scriptAttribution,
  forcedLayout,
];
