// Prometheus metrics. Cache hit/miss per rule is only known to nginx, so the
// nginx access log is shipped over local syslog (UDP) into this process and
// counted here; the resolver and origin count their own traffic directly.
import { createSocket, type Socket } from 'node:dgram';
import { Counter, Gauge, Registry } from 'prom-client';

import { log } from './log.js';

export const registry = new Registry();

export const metrics = {
  requests: new Counter({
    name: 'edge_requests_total',
    help: 'Client requests by rule, nginx cache status and HTTP status',
    labelNames: ['rule', 'cache', 'status'] as const,
    registers: [registry],
  }),
  upstreamErrors: new Counter({
    name: 'edge_upstream_errors_total',
    help: 'Origin responses with a 5xx status, by rule',
    labelNames: ['rule'] as const,
    registers: [registry],
  }),
  resolves: new Counter({
    name: 'edge_resolve_total',
    help: 'Rule resolutions by outcome (rule id, none, not_ready)',
    labelNames: ['rule'] as const,
    registers: [registry],
  }),
  originRequests: new Counter({
    name: 'edge_origin_requests_total',
    help: 'Object fetches from the storage origin by result',
    labelNames: ['result'] as const,
    registers: [registry],
  }),
  ruleHealthy: new Gauge({
    name: 'edge_rule_healthy',
    help: '1 when the rule bundle exists at the origin, 0 otherwise',
    labelNames: ['rule'] as const,
    registers: [registry],
  }),
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
