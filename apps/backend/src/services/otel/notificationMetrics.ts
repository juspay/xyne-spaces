import { metrics } from '@opentelemetry/api';
import type { Counter, Histogram, UpDownCounter, Meter } from '@opentelemetry/api';
import { config } from '@/config/env';

function getMeter(): Meter {
  return metrics.getMeter(config.otel.serviceName);
}

// Notification Job Created Counter
let _notificationJobCreated: Counter | null = null;
export function getNotificationJobCreated(): Counter {
  if (!_notificationJobCreated) {
    _notificationJobCreated = getMeter().createCounter('notification_job_created_total', {
      description: 'Total number of notification jobs created',
      unit: '1',
    });
  }
  return _notificationJobCreated;
}

// Notification Jobs Waiting UpDownCounter
let _notificationJobsWaiting: UpDownCounter | null = null;
export function getNotificationJobsWaiting(): UpDownCounter {
  if (!_notificationJobsWaiting) {
    _notificationJobsWaiting = getMeter().createUpDownCounter('notification_jobs_waiting', {
      description: 'Number of notification jobs currently waiting in the queue',
      unit: '1',
    });
  }
  return _notificationJobsWaiting;
}

// Notification Job Status Counter
let _notificationJobStatus: Counter | null = null;
export function getNotificationJobStatus(): Counter {
  if (!_notificationJobStatus) {
    _notificationJobStatus = getMeter().createCounter('notification_job_status_total', {
      description: 'Total number of notification jobs by status',
      unit: '1',
    });
  }
  return _notificationJobStatus;
}

// Notification Job Duration Histogram
let _notificationJobDuration: Histogram | null = null;
export function getNotificationJobDuration(): Histogram {
  if (!_notificationJobDuration) {
    _notificationJobDuration = getMeter().createHistogram('notification_job_duration_ms', {
      description: 'Duration of notification processing in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000],
      },
    });
  }
  return _notificationJobDuration;
}

// Notification Job Queue Time Histogram
let _notificationJobQueueTime: Histogram | null = null;
export function getNotificationJobQueueTime(): Histogram {
  if (!_notificationJobQueueTime) {
    _notificationJobQueueTime = getMeter().createHistogram('notification_job_queue_time_ms', {
      description: 'Time spent in queue before processing in milliseconds',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [10, 50, 100, 250, 500, 1000, 2500, 5000],
      },
    });
  }
  return _notificationJobQueueTime;
}

// Notification Jobs Expected Counter
let _notificationJobsExpected: Counter | null = null;
export function getNotificationJobsExpected(): Counter {
  if (!_notificationJobsExpected) {
    _notificationJobsExpected = getMeter().createCounter('notification_jobs_expected_total', {
      description: 'Total number of notification jobs expected to be created',
      unit: '1',
    });
  }
  return _notificationJobsExpected;
}

// FCM Payload Truncated Counter
let _notificationFcmPayloadTruncated: Counter | null = null;
export function getNotificationFcmPayloadTruncated(): Counter {
  if (!_notificationFcmPayloadTruncated) {
    _notificationFcmPayloadTruncated = getMeter().createCounter(
      'notification_fcm_payload_truncated_total',
      {
        description:
          'Total number of FCM push payloads that had to be trimmed to fit the 4KB data limit',
        unit: '1',
      },
    );
  }
  return _notificationFcmPayloadTruncated;
}

// ---------------------------------------------------------------------------
// SDLCT-0002: Notification Log Pipeline Completeness metrics
// ---------------------------------------------------------------------------

// Total notification-log lifecycle events recorded (labels: eventType, channel, status)
let _notificationLogEvents: Counter | null = null;
export function getNotificationLogEvents(): Counter {
  if (!_notificationLogEvents) {
    _notificationLogEvents = getMeter().createCounter('notification_log_events_total', {
      description: 'Total number of notification lifecycle log events recorded',
      unit: '1',
    });
  }
  return _notificationLogEvents;
}

// Fail-soft write failures (the audit path must never break delivery)
let _notificationLogWriteFailures: Counter | null = null;
export function getNotificationLogWriteFailures(): Counter {
  if (!_notificationLogWriteFailures) {
    _notificationLogWriteFailures = getMeter().createCounter(
      'notification_log_write_failures_total',
      {
        description: 'Total number of notification-log write failures (swallowed, non-fatal)',
        unit: '1',
      },
    );
  }
  return _notificationLogWriteFailures;
}

// Completeness classifications (labels: status = COMPLETE|INCOMPLETE|FAILED|UNKNOWN)
let _notificationPipelineCompleteness: Counter | null = null;
export function getNotificationPipelineCompleteness(): Counter {
  if (!_notificationPipelineCompleteness) {
    _notificationPipelineCompleteness = getMeter().createCounter(
      'notification_pipeline_completeness_total',
      {
        description: 'Count of pipeline completeness classifications by resulting status',
        unit: '1',
      },
    );
  }
  return _notificationPipelineCompleteness;
}

// Missing-stage occurrences observed during completeness classification (label: stage)
let _notificationPipelineMissingStage: Counter | null = null;
export function getNotificationPipelineMissingStage(): Counter {
  if (!_notificationPipelineMissingStage) {
    _notificationPipelineMissingStage = getMeter().createCounter(
      'notification_pipeline_missing_stage_total',
      {
        description: 'Count of required pipeline stages found missing during classification',
        unit: '1',
      },
    );
  }
  return _notificationPipelineMissingStage;
}

// End-to-end pipeline latency (first event -> terminal event), in ms
let _notificationPipelineLatency: Histogram | null = null;
export function getNotificationPipelineLatency(): Histogram {
  if (!_notificationPipelineLatency) {
    _notificationPipelineLatency = getMeter().createHistogram('notification_pipeline_latency_ms', {
      description: 'End-to-end notification pipeline latency from first to terminal event',
      unit: 'ms',
      advice: {
        explicitBucketBoundaries: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
      },
    });
  }
  return _notificationPipelineLatency;
}
