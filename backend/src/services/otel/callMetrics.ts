import { metrics } from '@opentelemetry/api';
import type { Counter, Meter, Attributes } from '@opentelemetry/api';
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
export const callNotifications: Counter<CallNotificationAttributes> = new Proxy({} as Counter<CallNotificationAttributes>, {
  get(_target, prop) {
    if (!_callNotifications) {
      _callNotifications = getMeter().createCounter('call_notifications_total', {
        description: 'Total number of call notifications with status',
        unit: '1',
      });
    }
    return _callNotifications[prop as keyof Counter<CallNotificationAttributes>];
  },
});

// Call Jobs Counter
let _callJobs: Counter<CallJobAttributes> | null = null;
export const callJobs: Counter<CallJobAttributes> = new Proxy({} as Counter<CallJobAttributes>, {
  get(_target, prop) {
    if (!_callJobs) {
      _callJobs = getMeter().createCounter('call_jobs_total', {
        description: 'Total number of call jobs with status',
        unit: '1',
      });
    }
    return _callJobs[prop as keyof Counter<CallJobAttributes>];
  },
});
