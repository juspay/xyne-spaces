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
