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

class CallMetrics {
  private _meter: Meter | undefined;
  
  private _callNotifications: Counter<CallNotificationAttributes> | undefined;
  private _callJobs: Counter<CallJobAttributes> | undefined;

  private get meter(): Meter {
    if (!this._meter) {
      this._meter = metrics.getMeter(config.otel.serviceName);
    }
    return this._meter;
  }

  get callNotifications(): Counter<CallNotificationAttributes> {
    if (!this._callNotifications) {
      this._callNotifications = this.meter.createCounter('call_notifications_total', {
        description: 'Total number of call notifications with status',
      });
    }
    return this._callNotifications;
  }

  get callJobs(): Counter<CallJobAttributes> {
    if (!this._callJobs) {
      this._callJobs = this.meter.createCounter('call_jobs_total', {
        description: 'Total number of call jobs with status',
      });
    }
    return this._callJobs;
  }
}

export const callMetrics = new CallMetrics();
