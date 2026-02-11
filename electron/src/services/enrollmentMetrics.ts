/**
 * OpenTelemetry Onboarding Error Metrics
 *
 * Defines all enrollment/onboarding error metrics using OpenTelemetry SDK.
 * These metrics track enrollment failures, duplicate attempts, and certificate issues.
 *
 * Note: Metrics are lazy-initialized to ensure OTel provider is ready.
 * The first time a metric is used, it will be created.
 */

import { metrics } from '@opentelemetry/api';
import type { Counter, Meter } from '@opentelemetry/api';

const OTEL_SERVICE_NAME = 'xyne-spaces-desktop';

function getMeter(): Meter {
  return metrics.getMeter(OTEL_SERVICE_NAME);
}

let _enrollmentSkipped: Counter | null = null;
let _mtlsFrontendLoaded: Counter | null = null;
let _devicePasswordPopup: Counter | null = null;
let _enrollmentDone: Counter | null = null;
let _dashboardLoad: Counter | null = null;

export const enrollmentSkipped: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_enrollmentSkipped) {
      _enrollmentSkipped = getMeter().createCounter('enrollment_skipped_total', {
        description: 'Total number of enrollment skip events',
        unit: '1',
      });
    }
    return _enrollmentSkipped[prop as keyof Counter];
  },
});

export const mtlsFrontendLoaded: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_mtlsFrontendLoaded) {
      _mtlsFrontendLoaded = getMeter().createCounter('mtls_frontend_loaded_total', {
        description: 'Total number of mTLS frontend load events',
        unit: '1',
      });
    }
    return _mtlsFrontendLoaded[prop as keyof Counter];
  },
});

export const devicePasswordPopup: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_devicePasswordPopup) {
      _devicePasswordPopup = getMeter().createCounter('device_password_popup_total', {
        description: 'Total number of device password popup events',
        unit: '1',
      });
    }
    return _devicePasswordPopup[prop as keyof Counter];
  },
});

export const enrollmentDone: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_enrollmentDone) {
      _enrollmentDone = getMeter().createCounter('enrollment_done_total', {
        description: 'Total number of enrollment done events',
        unit: '1',
      });
    }
    return _enrollmentDone[prop as keyof Counter];
  },
});

export const dashboardLoad: Counter = new Proxy({} as Counter, {
  get(_target, prop) {
    if (!_dashboardLoad) {
      _dashboardLoad = getMeter().createCounter('frontend_redirect_total', {
        description: 'Total number of frontend redirect events',
        unit: '1',
      });
    }
    return _dashboardLoad[prop as keyof Counter];
  },
});