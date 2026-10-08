import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

let _zeroMutationOperations: Counter | null = null;
export function getZeroMutationOperations(): Counter {
  if (!_zeroMutationOperations) {
    _zeroMutationOperations = getMeter().createCounter('zero_mutation_operations', {
      description: 'Total number of Zero mutation operations with stage (start, success, error)',
      unit: '1',
    });
  }
  return _zeroMutationOperations;
}

let _zeroMutationLatency: Histogram | null = null;
export function getZeroMutationLatency(): Histogram {
  if (!_zeroMutationLatency) {
    _zeroMutationLatency = getMeter().createHistogram('zero_mutation_latency', {
      description: 'Latency of Zero mutations in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [
          10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600,
        ],
      },
    });
  }
  return _zeroMutationLatency;
}

let _zeroQueryOperations: Counter | null = null;
export function getZeroQueryOperations(): Counter {
  if (!_zeroQueryOperations) {
    _zeroQueryOperations = getMeter().createCounter('zero_query_operations', {
      description: 'Total number of Zero query operations with stage (start, success, error)',
      unit: '1',
    });
  }
  return _zeroQueryOperations;
}

// Slack Connect — counts canvas/channel child query executions by lookup mode so the
// new (connectId) vs old (canvasId/channelId) split is visible in Grafana (victoriametrics).
// Labels: entity (canvas|channel), table, mode (connect_id|legacy).
let _connectQueryMode: Counter | null = null;
export function getConnectQueryMode(): Counter {
  if (!_connectQueryMode) {
    _connectQueryMode = getMeter().createCounter('connect_query_mode', {
      description: 'Slack Connect child-query executions by lookup mode (connect_id vs legacy)',
      unit: '1',
    });
  }
  return _connectQueryMode;
}

// Slack Connect — counts canvas/channel child ACL evaluations by workspace-truth source.
// Unlike the query-mode metric, the ACL is NOT flag-gated: connectId present → connect_group
// truth; else workspaceId. Labels: entity, table, layer (zero|prisma), op (read|write),
// mode (connect_group|workspace), outcome (ok|error_fallback — a real Prisma reach fallback).
let _connectAclMode: Counter | null = null;
export function getConnectAclMode(): Counter {
  if (!_connectAclMode) {
    _connectAclMode = getMeter().createCounter('connect_acl_mode', {
      description: 'Slack Connect ACL evaluations by workspace-truth source (connect_group vs workspace)',
      unit: '1',
    });
  }
  return _connectAclMode;
}

let _zeroQueryLatency: Histogram | null = null;
export function getZeroQueryLatency(): Histogram {
  if (!_zeroQueryLatency) {
    _zeroQueryLatency = getMeter().createHistogram('zero_query_latency', {
      description: 'Latency of Zero queries in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [
          10, 25, 50, 100, 200, 400, 800, 1600, 3200, 6400, 12800, 25600,
        ],
      },
    });
  }
  return _zeroQueryLatency;
}
