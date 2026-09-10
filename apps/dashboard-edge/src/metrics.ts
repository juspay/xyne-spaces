// OpenTelemetry metrics. Cache hit/miss per rule is only known to nginx, so
// the nginx access log is shipped over local syslog (UDP) into this process
// and counted here; the resolver and origin count their own traffic directly.
// Everything is exported to the collector by telemetry.ts.
import { createSocket, type Socket } from 'node:dgram';
import {
  type Attributes,
  type Counter,
  type Meter,
  metrics as otelMetrics,
} from '@opentelemetry/api';

import { log } from './log.js';

const METER_NAME = 'xyne-spaces-dashboard-edge';

interface Instruments {
  requests: Counter;
  upstreamErrors: Counter;
  resolves: Counter;
  originRequests: Counter;
}

// Instruments are created on first use, after telemetry.ts has registered the
// global meter provider; created earlier they would bind to the no-op provider.
let instruments: Instruments | null = null;
const ruleHealth = new Map<string, number>();

function getInstruments(): Instruments {
  if (instruments) {
    return instruments;
  }
  const meter: Meter = otelMetrics.getMeter(METER_NAME);
  instruments = {
    requests: meter.createCounter('edge_requests_total', {
      description: 'Client requests by rule, nginx cache status and HTTP status',
    }),
    upstreamErrors: meter.createCounter('edge_upstream_errors_total', {
      description: 'Origin responses with a 5xx status, by rule',
    }),
    resolves: meter.createCounter('edge_resolve_total', {
      description: 'Rule resolutions by outcome (rule id, none, not_ready, bad_request)',
    }),
    originRequests: meter.createCounter('edge_origin_requests_total', {
      description: 'Object fetches from the storage origin by result',
    }),
  };
  meter
    .createObservableGauge('edge_rule_healthy', {
      description: '1 when the rule bundle exists at the origin, 0 otherwise',
    })
    .addCallback((result) => {
      for (const [rule, value] of ruleHealth) {
        result.observe(value, { rule });
      }
    });
  return instruments;
}

function counter(name: keyof Instruments): { inc: (attributes?: Attributes) => void } {
  return {
    inc: (attributes: Attributes = {}): void => {
      getInstruments()[name].add(1, attributes);
    },
  };
}

export const metrics = {
  requests: counter('requests'),
  upstreamErrors: counter('upstreamErrors'),
  resolves: counter('resolves'),
  originRequests: counter('originRequests'),
  setRuleHealth(rule: string, healthy: boolean): void {
    getInstruments();
    ruleHealth.set(rule, healthy ? 1 : 0);
  },
};

interface AccessLine {
  rule?: string;
  cache?: string;
  status?: number | string;
  upstream_status?: string;
}

/** Count one nginx access-log line (the JSON `edge` log_format). */
export function observeAccessLine(json: string): void {
  let line: AccessLine;
  try {
    line = JSON.parse(json) as AccessLine;
  } catch {
    return;
  }
  const rule = line.rule && line.rule !== '' ? line.rule : 'none';
  const cache = line.cache && line.cache !== '' ? line.cache : 'NONE';
  metrics.requests.inc({ rule, cache, status: String(line.status ?? '0') });
  const last = /(\d+)\s*$/.exec(line.upstream_status ?? '');
  if (last && Number(last[1]) >= 500) {
    metrics.upstreamErrors.inc({ rule });
  }
}

/** Listen for nginx's `access_log syslog:server=127.0.0.1:<port>` datagrams. */
export function startSyslogListener(port: number, addr: string): Socket {
  const socket = createSocket('udp4');
  socket.on('message', (msg) => {
    const text = msg.toString('utf8');
    const start = text.indexOf('{');
    if (start >= 0) {
      observeAccessLine(text.slice(start));
    }
  });
  socket.on('error', (err) => log.error('syslog listener error', { err }));
  socket.bind(port, addr, () => log.info('syslog metrics listener up', { addr, port }));
  return socket;
}
