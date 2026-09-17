import type { EventType, LogLevel } from './events.js';

/**
 * Platform-agnostic Logger interface.
 * Dashboard implements with Web Workers + OTel.
 * Lotus implements with console or native logging.
 */
export interface Logger {
  debug(event: EventType, extraFields?: Record<string, unknown>): void;
  info(event: EventType, extraFields?: Record<string, unknown>): void;
  warn(event: EventType, extraFields?: Record<string, unknown>): void;
  error(event: EventType, extraFields?: Record<string, unknown>): void;

  setEmailId?(emailId: string): void;
  setZeroClientId?(zeroClientId: string): void;
  setZeroClientGroupId?(promise: Promise<string>): void;

  zeroClientId?: string | null;
  zeroClientGroupId?: string | null;
}

/**
 * No-op logger for environments without logging configured.
 */
export const noopLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

/**
 * Console-based logger for simple environments (e.g. React Native dev).
 * This is the intentional fallback for consumers that have no native logger.
 */
/* eslint-disable no-console */
export const consoleLogger: Logger = {
  debug: (event, extra) => console.debug(`[${event}]`, extra ?? ''),
  info: (event, extra) => console.log(`[${event}]`, extra ?? ''),
  warn: (event, extra) => console.warn(`[${event}]`, extra ?? ''),
  error: (event, extra) => console.error(`[${event}]`, extra ?? ''),
};
/* eslint-enable no-console */

/**
 * Metrics recorder interface for OTel-like instrumentation.
 * Dashboard provides real OTel counters/histograms.
 * Lotus can provide no-op or native metrics.
 */
export interface MetricsRecorder {
  recordLatency(name: string, durationMs: number, attributes?: Record<string, string>): void;
  incrementCounter(name: string, attributes?: Record<string, string>): void;
}

export const noopMetrics: MetricsRecorder = {
  recordLatency: () => {},
  incrementCounter: () => {},
};
