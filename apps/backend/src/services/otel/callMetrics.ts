import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, Meter, Attributes } from '@opentelemetry/api';
import { config } from '@/config/env';

// Define Attribute Types
export interface CallNotificationAttributes extends Attributes {
  deliveryType: string;
  platform: string;
  status: 'created' | 'sent' | 'failed';
  failureReason?: string;
}

export interface CallJobAttributes extends Attributes {
  platform?: string;
  status: 'created' | 'completed' | 'failed';
}

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Call Notifications Counter
let _callNotifications: Counter<CallNotificationAttributes> | null = null;
export function getCallNotifications(): Counter<CallNotificationAttributes> {
  if (!_callNotifications) {
    _callNotifications = getMeter().createCounter('call_notifications_total', {
      description: 'Total number of call notifications with status',
      unit: '1',
    });
  }
  return _callNotifications;
}

// Call Jobs Counter
let _callJobs: Counter<CallJobAttributes> | null = null;
export function getCallJobs(): Counter<CallJobAttributes> {
  if (!_callJobs) {
    _callJobs = getMeter().createCounter('call_jobs_total', {
      description: 'Total number of call jobs with status',
      unit: '1',
    });
  }
  return _callJobs;
}

let _callInviteDetectionResults: Counter | null = null;
export function getCallInviteDetectionResults(): Counter {
  if (!_callInviteDetectionResults) {
    _callInviteDetectionResults = getMeter().createCounter('detect_internal_result_total', {
      description: 'Unified call invite detections by internal/external result',
      unit: '1',
    });
  }
  return _callInviteDetectionResults;
}

let _callInviteDetectionExternalReasons: Counter | null = null;
export function getCallInviteDetectionExternalReasons(): Counter {
  if (!_callInviteDetectionExternalReasons) {
    _callInviteDetectionExternalReasons = getMeter().createCounter(
      'detect_internal_external_reason_total',
      {
        description: 'Internal-only reasons a unified call invite stayed external',
        unit: '1',
      },
    );
  }
  return _callInviteDetectionExternalReasons;
}

let _callInviteDetectionRefreshes: Counter | null = null;
export function getCallInviteDetectionRefreshes(): Counter {
  if (!_callInviteDetectionRefreshes) {
    _callInviteDetectionRefreshes = getMeter().createCounter(
      'detect_internal_refresh_total',
      {
        description: 'Target-workspace refresh attempts for unified call invites',
        unit: '1',
      },
    );
  }
  return _callInviteDetectionRefreshes;
}

let _callInviteDetectionLatency: Histogram | null = null;
export function getCallInviteDetectionLatency(): Histogram {
  if (!_callInviteDetectionLatency) {
    _callInviteDetectionLatency = getMeter().createHistogram('detect_internal_latency_ms', {
      description: 'Unified call invite detection latency',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
      },
    });
  }
  return _callInviteDetectionLatency;
}
