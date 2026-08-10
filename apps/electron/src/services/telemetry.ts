/**
 * OpenTelemetry Telemetry Initialization
 *
 * Initializes the OpenTelemetry SDK for metrics collection and export.
 * Metrics are sent to the OTel Collector via OTLP/HTTP protocol.
 */

import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, SEMRESATTRS_SERVICE_INSTANCE_ID } from '@opentelemetry/semantic-conventions';
import { metrics } from '@opentelemetry/api';
import { Logger } from './logger/Logger';
import { EnrollmentEvent } from './logger/enrollment-events';
import ElectronEvent from './logger/electron-events';
import { config } from '../app/config';
import Store from 'electron-store';
import { app } from 'electron';
import { getMainWindow } from '../window/manager';

// local storage service instance id
const store = new Store<{deviceId: string}>({});
const preProdEnabled = store.get(config.preProdKey, false) as boolean;

// OpenTelemetry Configuration
export const OTEL_METRICS_ENDPOINT = `${config.UNPROTECTED_URL}/godel/v1/metrics`;
export const OTEL_SERVICE_NAME = preProdEnabled ? 'xyne-spaces-desktop-preprod' : 'xyne-spaces-desktop';
export const OTEL_EXPORT_INTERVAL_MS = 10000; // Default: 10 seconds

// Track the meter provider instance for cleanup
let meterProviderInstance: MeterProvider | null = null;
let cpuSnapshotLogRegistered = false;
const CPU_SNAPSHOT_INTERVAL_MS = 30_000;

/**
 * Initialize OpenTelemetry metrics provider
 * Should be called once at application startup
 */
export function initializeTelemetry(): void {
  if (!config.enableOtelMetrics) {
    Logger.info(EnrollmentEvent.OTEL_INIT_SKIPPED);
    return;
  }

  try {
    // Create resource with service identification
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: OTEL_SERVICE_NAME,
      [SEMRESATTRS_SERVICE_INSTANCE_ID]: getOrGenerateDeviceId(),
    });

    // Create OTLP/HTTP exporter
    const metricExporter = new OTLPMetricExporter({
      url: OTEL_METRICS_ENDPOINT,
      // Timeout for export requests
      timeoutMillis: 10000,
    });

    // Create meter provider with periodic export
    meterProviderInstance = new MeterProvider({
      resource: resource,
      readers: [
        new PeriodicExportingMetricReader({
          exporter: metricExporter,
          exportIntervalMillis: OTEL_EXPORT_INTERVAL_MS,
        }),
      ],
    });


    // Set as global meter provider
    metrics.setGlobalMeterProvider(meterProviderInstance);
    registerElectronCpuSnapshotLog();
    Logger.info(EnrollmentEvent.OTEL_INIT_SUCCESS);
  } catch (error) {
    Logger.logError(EnrollmentEvent.OTEL_INIT_FAILED, error);
    // Don't throw - telemetry failure shouldn't break the app
  }
}

function registerElectronCpuSnapshotLog(): void {
  if (cpuSnapshotLogRegistered) return;

  cpuSnapshotLogRegistered = true;
  setInterval(() => {
    const mainWindow = getMainWindow();
    if (!mainWindow || mainWindow.isDestroyed()) return;

    const rendererPid = mainWindow.webContents.getOSProcessId();
    if (!rendererPid) return;

    const appMetric = app.getAppMetrics().find(metric => metric.pid === rendererPid);
    if (!appMetric?.cpu) return;

    Logger.info(ElectronEvent.ELECTRON_CPU_USAGE_SNAPSHOT, {
      cpuUsagePercent: appMetric.cpu.percentCPUUsage,
      idleWakeupsPerSecond: appMetric.cpu.idleWakeupsPerSecond,
      pageUrl: mainWindow.webContents.getURL(),
      processId: rendererPid,
    });
  }, CPU_SNAPSHOT_INTERVAL_MS);
}

/**
 * Helper function to safely record metrics
 * Wraps metric operations in try-catch to prevent app crashes
 */
export function safeRecordMetric(fn: () => void): void {
  if (!config.enableOtelMetrics) {
    return;
  }

  try {
    fn();
  } catch (error) {
    Logger.logError(EnrollmentEvent.OTEL_METRIC_ERROR, error);
  }
}

function getOrGenerateDeviceId(): string {
  let deviceId = store.get('deviceId');
  if (!deviceId) {
    deviceId = crypto.randomUUID();
    store.set('deviceId', deviceId);
  }
  return deviceId;
} 