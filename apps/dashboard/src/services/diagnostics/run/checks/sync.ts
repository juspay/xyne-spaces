import { maxOf, percentile, slopePerMinute } from '../stats';
import {
  gradeLower,
  measurement,
  ms,
  samplesOf,
  seriesConfidence,
  skipped,
  values,
  worstStatus,
  type Check,
} from './shared';
import type { ZeroOpStat } from '../../types';

/**
 * Live sync and network checks.
 *
 * Everything here is measured from traffic the app generated on its own. The run
 * issues no requests of its own: a diagnostic that adds load changes the thing
 * it is measuring, and on a connection already struggling it would make the
 * user's situation worse to produce its own evidence.
 */

const QUERY_P95_WARN_MS = 1000;
const QUERY_P95_BAD_MS = 3000;
const MUTATION_P95_WARN_MS = 1000;
const MUTATION_P95_BAD_MS = 3000;
const API_P95_WARN_MS = 800;
const API_P95_BAD_MS = 2000;

const PENDING_WARN = 5;
const PENDING_BAD = 20;
/** A backlog growing this fast is not draining, whatever its absolute size. */
const PENDING_GROWTH_WARN_PER_MIN = 5;

const RTT_WARN_MS = 150;
const RTT_BAD_MS = 400;

/** A screen waiting this long on data is one a person has noticed. */
const OUTSTANDING_WARN_MS = 3_000;
const OUTSTANDING_BAD_MS = 10_000;

/** Connected, with work outstanding, and nothing arriving for this long. */
const SILENCE_WARN_MS = 8_000;
const SILENCE_BAD_MS = 20_000;

function worstNamed(rows: ZeroOpStat[]): ZeroOpStat | undefined {
  return rows.find(row => row.count > 0);
}

/**
 * Connected, with work outstanding, and nothing coming back.
 *
 * This is the only client-visible trace of the server rebuilding a client
 * group's query set. On reconnect the view-syncer re-hydrates every query in
 * the CVR — including ones no screen is watching and the client never re-asked
 * for — and processes that group's pipelines one at a time. A single expensive
 * query in there stalls all of them, and the client is told nothing: it sees a
 * healthy socket and no data.
 *
 * So the silence is the evidence. It cannot name the query responsible — that
 * lives in the CVR, which the client cannot read — but it distinguishes "the
 * server is not answering me" from every local cause, which is the fork a user
 * cannot otherwise get past.
 */
export const serverSilence: Check = context => {
  const liveness = context.window.liveness;
  if (!liveness) {
    return skipped(
      'server-silence',
      'Server responsiveness',
      'sync',
      'Connection state was not readable for this run.',
    );
  }

  if (liveness.connection !== 'connected') {
    return skipped(
      'server-silence',
      'Server responsiveness',
      'sync',
      `The connection was "${liveness.connection}" when the run ended, so silence is expected — see "Live connection".`,
    );
  }

  // An idle app with nothing outstanding is quiet because there is nothing to
  // send, which is health rather than a fault. Only silence with work waiting
  // behind it means anything.
  const outstanding = context.window.outstandingQueries.length;
  const workWaiting = outstanding > 0 || liveness.pendingMutations > 0;
  if (!workWaiting) {
    return {
      id: 'server-silence',
      title: 'Server responsiveness',
      category: 'sync',
      status: 'pass',
      confidence: 'high',
      confidenceReason: 'Read directly at the moment the run ended.',
      summary: 'Connected, with nothing left waiting on the server.',
      measurements: [
        measurement('Last heard from server', `${(liveness.silentForMs / 1000).toFixed(1)}s ago`),
        measurement('Waiting on server', '0'),
      ],
      evidence: ['Quiet with nothing outstanding is the app idle, not the server stalling'],
      remediation: '',
      actionable: false,
    };
  }

  const status = gradeLower(liveness.silentForMs, SILENCE_WARN_MS, SILENCE_BAD_MS);
  const reconnected = context.window.connectionEvents.some(event => event.name === 'connected');

  return {
    id: 'server-silence',
    title: 'Server responsiveness',
    category: 'sync',
    status,
    confidence: 'high',
    confidenceReason: 'Read directly at the moment the run ended, not sampled.',
    summary:
      status === 'pass'
        ? 'The server is answering normally.'
        : `The connection is up, but the server has sent nothing for ${(liveness.silentForMs / 1000).toFixed(1)}s while ${outstanding} request(s) and ${liveness.pendingMutations} change(s) wait.`,
    measurements: [
      measurement(
        'Silent for',
        `${(liveness.silentForMs / 1000).toFixed(1)}s`,
        `warn ≥ ${SILENCE_WARN_MS / 1000}s, fail ≥ ${SILENCE_BAD_MS / 1000}s`,
      ),
      measurement(
        'Connected for',
        liveness.connectedForMs === null ? '—' : `${(liveness.connectedForMs / 1000).toFixed(1)}s`,
      ),
      measurement('Requests waiting', String(outstanding)),
      measurement('Changes waiting', String(liveness.pendingMutations)),
    ],
    evidence: [
      'The socket is healthy and the device is not the bottleneck — the server simply is not sending anything back',
      ...(reconnected && status !== 'pass'
        ? [
            'The connection was re-established during this run. After a reconnect the server rebuilds every subscription this client had, including ones no screen is showing, and works through them one at a time — so one expensive rebuild delays all of them',
          ]
        : []),
      ...(status !== 'pass'
        ? [
            'Which subscription is responsible is not visible from this device; it is held in server-side state the client cannot read',
          ]
        : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Report the time of this run. The server logs can name the query being rebuilt, which this device cannot see. Reloading or switching screens will not help — the work is queued on the server, and re-opening the screen queues behind it again.',
    actionable: true,
  };
};

export const zeroConnection: Check = context => {
  const { connectionEvents, disconnects, hiddenDisconnects, durationMs } = context.window;

  if (!context.zeroObserved) {
    return skipped(
      'zero-connection',
      'Live connection',
      'sync',
      'No live-sync client was being observed during the run, so its state is unknown rather than healthy.',
    );
  }

  if (connectionEvents.length === 0 && disconnects === 0) {
    return {
      id: 'zero-connection',
      title: 'Live connection',
      category: 'sync',
      status: 'pass',
      confidence: durationMs >= 15_000 ? 'high' : 'low',
      confidenceReason:
        durationMs >= 15_000
          ? `The connection held without a single state change for ${Math.round(durationMs / 1000)}s.`
          : 'The run was too short to say much about connection stability.',
      summary: 'The live connection stayed up for the whole run.',
      measurements: [measurement('Drops', '0'), measurement('State changes', '0')],
      evidence: ['No unexpected disconnects were observed during the run'],
      remediation: '',
      actionable: false,
    };
  }

  // Any unexpected drop inside a thirty-second window is already abnormal — the
  // hourly rate the live panel reports is the wrong lens at this timescale.
  const status = disconnects === 0 ? 'pass' : disconnects === 1 ? 'warn' : 'fail';

  return {
    id: 'zero-connection',
    title: 'Live connection',
    category: 'sync',
    status,
    confidence: 'high',
    confidenceReason: 'Every connection transition is observed directly, not sampled.',
    summary:
      status === 'pass'
        ? 'The live connection stayed up for the whole run.'
        : `The live connection dropped ${disconnects} time(s) during a ${Math.round(durationMs / 1000)}s run.`,
    measurements: [
      measurement('Unexpected drops', String(disconnects), 'warn ≥ 1 within the run'),
      measurement('State changes', String(connectionEvents.length)),
      ...(hiddenDisconnects > 0
        ? [measurement('Expected drops', String(hiddenDisconnects), 'window hidden — not a fault')]
        : []),
    ],
    evidence: [
      ...connectionEvents
        .filter(event => event.name !== 'connected' && event.name !== 'connecting')
        .slice(0, 4)
        .map(event => `${event.name}${event.reason ? `: ${event.reason}` : ''}`),
      ...(hiddenDisconnects > 0
        ? [
            `${hiddenDisconnects} drop(s) were the deliberate one that follows the window being hidden, and are not counted as faults`,
          ]
        : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Each drop means updates arrive late and unsent changes wait. Repeated drops with the same reason are worth reporting with that reason.',
    actionable: true,
  };
};

/**
 * The check for a screen that never finishes loading.
 *
 * Every other measurement of Zero here is derived from queries that completed,
 * which means a request stuck for a minute contributes nothing until it ends —
 * and produces a report saying data loading was never measured. That is the
 * precise moment someone opens this panel, so the absence of a completion has
 * to be a finding in its own right rather than a gap in the data.
 */
export const stalledQueries: Check = context => {
  const outstanding = context.window.outstandingQueries;
  const worst = outstanding[0];

  if (!worst) {
    return {
      id: 'stalled-queries',
      title: 'Requests still waiting',
      category: 'sync',
      status: 'pass',
      confidence: 'high',
      confidenceReason: 'Read directly at the moment the run ended.',
      summary: 'Nothing was left waiting on the server when the run ended.',
      measurements: [measurement('Still waiting', '0')],
      evidence: [],
      remediation: '',
      actionable: false,
    };
  }

  const status = gradeLower(worst.waitingMs, OUTSTANDING_WARN_MS, OUTSTANDING_BAD_MS);
  const blockedShare = context.window.durationMs
    ? (context.window.blockedMs / context.window.durationMs) * 100
    : 0;
  // Whether this device was busy decides who the wait belongs to. A responsive
  // app with a request outstanding for half a minute is not a slow app — it is
  // an app waiting, and saying so spares the user chasing their own machine.
  const deviceWasIdle = blockedShare < 10;

  return {
    id: 'stalled-queries',
    title: 'Requests still waiting',
    category: 'sync',
    status,
    confidence: 'high',
    confidenceReason: 'Read directly at the moment the run ended, not sampled.',
    summary:
      status === 'pass'
        ? `${outstanding.length} request(s) were still in progress, none of them for long.`
        : `${worst.name} has been waiting ${(worst.waitingMs / 1000).toFixed(1)}s for the server and has not come back.`,
    measurements: [
      measurement(
        'Longest wait',
        `${(worst.waitingMs / 1000).toFixed(1)}s`,
        `warn ≥ ${OUTSTANDING_WARN_MS / 1000}s, fail ≥ ${OUTSTANDING_BAD_MS / 1000}s`,
      ),
      measurement('Query', worst.name),
      measurement('Still waiting', String(outstanding.length)),
    ],
    evidence: [
      ...outstanding
        .slice(0, 5)
        .map(row => `${row.name} — waiting ${(row.waitingMs / 1000).toFixed(1)}s`),
      ...(status !== 'pass' && deviceWasIdle
        ? [
            'This device was responsive throughout, so the delay is the server not answering rather than anything running here',
          ]
        : []),
      ...(status !== 'pass' && context.window.disconnects > 0
        ? [
            `The live connection dropped ${context.window.disconnects} time(s) during the run, which forces every query to be re-established from scratch`,
          ]
        : []),
      'A screen closed before its data arrived can also leave a request here',
      ...(status !== 'pass'
        ? [
            'This lists what this device asked for and is still waiting on. A reconnect also makes the server rebuild subscriptions the client never re-asked for, and those are not visible here — so the query actually holding things up may not be in this list',
          ]
        : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : `Report the queries named above with the time of this run. One query failing to return blocks the others behind it, so a single slow one can leave a whole screen loading.`,
    actionable: true,
  };
};

export const zeroQueryLatency: Check = context => {
  const durations = context.window.zeroQueryDurations;
  if (durations.length === 0) {
    const outstanding = context.window.outstandingQueries.length;
    return skipped(
      'zero-query-latency',
      'Data loading',
      'sync',
      outstanding > 0
        ? `No query completed during the run, though ${outstanding} were outstanding — see "Requests still waiting".`
        : 'No data was requested during the run. Open a screen while the run is active to measure this.',
    );
  }

  const p95 = percentile(durations, 95) ?? 0;
  const p50 = percentile(durations, 50) ?? 0;
  const status = gradeLower(p95, QUERY_P95_WARN_MS, QUERY_P95_BAD_MS);
  const { confidence, reason } = seriesConfidence(context, durations.length, 10, 30);
  const worst = worstNamed(context.window.zeroQueries);
  const errors = context.window.zeroQueries.reduce((sum, row) => sum + row.errors, 0);

  return {
    id: 'zero-query-latency',
    title: 'Data loading',
    category: 'sync',
    status: errors > 0 ? worstStatus([status, 'warn']) : status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'Screens received their data promptly.'
        : `The slowest 5% of data requests took ${ms(p95)}.`,
    measurements: [
      measurement(
        'Slowest 5%',
        ms(p95),
        `warn ≥ ${QUERY_P95_WARN_MS}ms, fail ≥ ${QUERY_P95_BAD_MS}ms`,
      ),
      measurement('Typical', ms(p50)),
      measurement('Requests', String(durations.length)),
      ...(errors > 0 ? [measurement('Failures', String(errors))] : []),
    ],
    evidence: [
      ...(worst
        ? [`Slowest query: ${worst.name} at ${ms(worst.p95Ms)} (p95 over ${worst.count} call(s))`]
        : []),
      ...(errors > 0 ? [`${errors} query error(s) during the run`] : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Report the named query above. One slow query is a different problem from everything being slow, and has a different fix.',
    actionable: true,
  };
};

export const zeroSaveLatency: Check = context => {
  const durations = context.window.zeroMutationDurations;
  const errors = context.window.zeroMutations.reduce((sum, row) => sum + row.errors, 0);

  if (durations.length === 0 && errors === 0) {
    // Same blind spot as queries: this is fed by acknowledgements, so a write
    // that never gets one looks identical to no write at all. The pending count
    // is what distinguishes them.
    const peakPending = maxOf(values(samplesOf(context, 'zeroPendingMutations'))) ?? 0;
    return skipped(
      'zero-save-latency',
      'Saving changes',
      'sync',
      peakPending > 0
        ? `No change was confirmed during the run, though up to ${peakPending.toFixed(0)} were waiting — see "Unsent changes".`
        : 'Nothing was saved during the run. Send a message or edit something while the run is active to measure this.',
    );
  }

  const p95 = durations.length ? (percentile(durations, 95) ?? 0) : 0;
  const latencyStatus = durations.length
    ? gradeLower(p95, MUTATION_P95_WARN_MS, MUTATION_P95_BAD_MS)
    : 'inconclusive';
  const status = errors > 0 ? 'fail' : latencyStatus;
  const { confidence, reason } = seriesConfidence(context, durations.length, 5, 15);
  const worst = worstNamed(context.window.zeroMutations);

  return {
    id: 'zero-save-latency',
    title: 'Saving changes',
    category: 'sync',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      errors > 0
        ? `${errors} change(s) failed to save during the run.`
        : status === 'pass'
          ? 'Changes were confirmed by the server promptly.'
          : `The slowest 5% of saves waited ${ms(p95)} for confirmation.`,
    measurements: [
      measurement('Slowest 5%', ms(p95), `warn ≥ ${MUTATION_P95_WARN_MS}ms`),
      measurement('Saves', String(durations.length)),
      ...(errors > 0 ? [measurement('Failures', String(errors))] : []),
    ],
    evidence: [
      'Measures time until the server confirmed the change, not until it appeared on screen — edits look applied long before they are saved',
      ...(worst ? [`Slowest action: ${worst.name} at ${ms(worst.p95Ms)}`] : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : errors > 0
          ? 'Failed saves mean work was lost or silently retried. This is worth reporting immediately.'
          : 'Slow confirmation means a disconnect at the wrong moment could lose recent edits.',
    actionable: true,
  };
};

export const zeroWriteBacklog: Check = context => {
  const points = samplesOf(context, 'zeroPendingMutations');
  if (points.length === 0) {
    return skipped(
      'zero-write-backlog',
      'Unsent changes',
      'sync',
      'The pending-change count was not reported during the run.',
    );
  }

  const peak = maxOf(values(points)) ?? 0;
  const growth = slopePerMinute(points);
  const status = worstStatus([
    gradeLower(peak, PENDING_WARN, PENDING_BAD),
    growth !== null && growth >= PENDING_GROWTH_WARN_PER_MIN ? 'warn' : 'pass',
  ]);
  const { confidence, reason } = seriesConfidence(context, points.length, 5, 15);

  return {
    id: 'zero-write-backlog',
    title: 'Unsent changes',
    category: 'sync',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'Changes were sent as fast as they were made.'
        : `Up to ${peak.toFixed(0)} change(s) were waiting for the server at once.`,
    measurements: [
      measurement('Peak waiting', peak.toFixed(0), `warn ≥ ${PENDING_WARN}, fail ≥ ${PENDING_BAD}`),
      ...(growth === null
        ? []
        : [measurement('Trend', `${growth >= 0 ? '+' : ''}${growth.toFixed(1)}/min`)]),
    ],
    evidence: [
      'A backlog that drains is the app working normally; one that keeps climbing means writes are not getting through',
      ...(growth !== null && growth >= PENDING_GROWTH_WARN_PER_MIN
        ? ['The backlog was still growing when the run ended']
        : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'Do not close the app while changes are waiting — they are not saved on the server yet.',
    actionable: true,
  };
};

export const apiLatency: Check = context => {
  const durations = context.window.apiDurations;
  if (durations.length === 0) {
    return skipped(
      'api-latency',
      'Server requests',
      'network',
      'No server requests were made during the run.',
    );
  }

  const p95 = percentile(durations, 95) ?? 0;
  const status = gradeLower(p95, API_P95_WARN_MS, API_P95_BAD_MS);
  const { confidence, reason } = seriesConfidence(context, durations.length, 10, 30);
  const worst = [...context.window.api].sort((a, b) => b.p95Ms - a.p95Ms)[0];

  return {
    id: 'api-latency',
    title: 'Server requests',
    category: 'network',
    status,
    confidence,
    confidenceReason: reason,
    summary:
      status === 'pass'
        ? 'Server requests completed at a normal speed.'
        : `The slowest 5% of server requests took ${ms(p95)}.`,
    measurements: [
      measurement('Slowest 5%', ms(p95), `warn ≥ ${API_P95_WARN_MS}ms`),
      measurement('Requests', String(durations.length)),
      ...(worst ? [measurement('Slowest endpoint', worst.endpoint)] : []),
    ],
    evidence: [
      ...(worst
        ? [`${worst.endpoint}: ${ms(worst.p95Ms)} at p95 over ${worst.count} call(s)`]
        : []),
      'Measured from requests the app made on its own — the run issues none of its own, so it cannot add to a struggling connection',
    ],
    remediation: status === 'pass' ? '' : 'Report the endpoint named above along with this report.',
    actionable: true,
  };
};

export const networkQuality: Check = context => {
  const connection = context.device.connection;
  const rttSamples = values(samplesOf(context, 'networkRtt'));
  const rtt = rttSamples.length ? (percentile(rttSamples, 95) ?? 0) : (connection?.rttMs ?? 0);

  if (!connection || rtt <= 0) {
    return skipped(
      'network-quality',
      'Network quality',
      'network',
      'This browser does not estimate network latency. Server request timing above still applies.',
    );
  }

  const status = gradeLower(rtt, RTT_WARN_MS, RTT_BAD_MS);

  return {
    id: 'network-quality',
    title: 'Network quality',
    category: 'network',
    status,
    confidence: 'low',
    confidenceReason:
      'The browser’s own estimate, which is coarse and updates slowly. Treated as context rather than a measurement.',
    summary:
      status === 'pass'
        ? `Network round-trip is around ${ms(rtt)}.`
        : `The browser estimates a ${ms(rtt)} round-trip to the network.`,
    measurements: [
      measurement('Round-trip', ms(rtt), `warn ≥ ${RTT_WARN_MS}ms`),
      measurement('Connection type', connection.effectiveType),
      measurement('Downlink', `${connection.downlinkMbps.toFixed(1)} Mbps`),
      ...(connection.saveData ? [measurement('Data saver', 'On')] : []),
    ],
    evidence: [
      'Reported by the browser from recent traffic, not measured by this run',
      ...(connection.saveData
        ? ['Data saver is on, which makes the browser defer and throttle requests']
        : []),
    ],
    remediation:
      status === 'pass'
        ? ''
        : 'A slow link makes everything above it slower. Worth checking on a different network before reporting the app.',
    actionable: false,
  };
};

export const SYNC_CHECKS: Check[] = [
  serverSilence,
  stalledQueries,
  zeroConnection,
  zeroQueryLatency,
  zeroSaveLatency,
  zeroWriteBacklog,
  apiLatency,
  networkQuality,
];
