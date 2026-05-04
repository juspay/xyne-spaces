import crypto from "node:crypto";

/**
 * Simple structured logger with trace ID support.
 * Every log line includes the traceId so you can follow a request
 * across webhook → run → claw → result in Grafana.
 */

export function createTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
}

export function createLogger(component: string, traceId: string): Logger {
  const prefix = `[${component}] [${traceId}]`;

  return {
    info(message: string, data?: Record<string, unknown>) {
      if (data) {
        console.log(`${prefix} ${message}`, JSON.stringify(data));
      } else {
        console.log(`${prefix} ${message}`);
      }
    },
    warn(message: string, data?: Record<string, unknown>) {
      if (data) {
        console.warn(`${prefix} ${message}`, JSON.stringify(data));
      } else {
        console.warn(`${prefix} ${message}`);
      }
    },
    error(message: string, data?: Record<string, unknown>) {
      if (data) {
        console.error(`${prefix} ${message}`, JSON.stringify(data));
      } else {
        console.error(`${prefix} ${message}`);
      }
    },
  };
}
