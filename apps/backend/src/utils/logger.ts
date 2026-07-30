import winston from 'winston';
import { AsyncLocalStorage } from 'async_hooks';
import fluentLogger from 'fluent-logger';
import type { Socket } from 'net';
import { config } from '@/config/env';
import {
  ErrorTrace,
  createCallSiteError,
  createErrorTrace,
  findError,
  serializeError as serializeTraceError,
} from './errorTrace';

export interface LogContext {
  requestId?: string;
  zeroClientId?: string;
  zeroClientGroupId?: string;
  clientSessionId?: string;
  emailId?: string;
  appVersion?: string;
}

export const loggerContext = new AsyncLocalStorage<LogContext>();

const injectContext = winston.format((info) => {
  const context = loggerContext.getStore();
  if (context) {
    Object.assign(info, context);
  }

  return info;
});

const ERROR_PAYLOAD_KEYS = new Set(['config', 'request', 'response', 'headers', 'options']);
const REDACTED = '[REDACTED]';
const CALL_SITE_TRACE_KEY = '__callSiteTrace';

export function serializeError(value: unknown): Record<string, unknown> {
  return serializeTraceError(value);
}

const normalizeErrors = winston.format((info) => {
  if (info.level === 'error') {
    const splat = (info as Record<PropertyKey, unknown>)[Symbol.for('splat')];
    const infoRecord = info as Record<string, unknown>;
    const error =
      findError(info) ??
      (Array.isArray(splat) ? splat.map(findError).find(Boolean) : findError(splat));
    const metadataError = infoRecord.error;
    const splatError = Array.isArray(splat)
      ? splat.find(
          (item) =>
            item instanceof Error || (item !== null && typeof item === 'object' && 'error' in item)
        )
      : splat;
    const splatValue =
      splatError !== null && typeof splatError === 'object' && 'error' in splatError
        ? (splatError as Record<string, unknown>).error
        : splatError;
    const callSiteTrace = [
      infoRecord[CALL_SITE_TRACE_KEY],
      ...(Array.isArray(splat)
        ? splat.map((item) =>
            item !== null && typeof item === 'object'
              ? (item as Record<string, unknown>)[CALL_SITE_TRACE_KEY]
              : undefined
          )
        : []),
    ].find(
      (value): value is ErrorTrace =>
        value !== null && typeof value === 'object' && 'fingerprint' in value
    );
    delete infoRecord[CALL_SITE_TRACE_KEY];
    const traceValue = error ?? metadataError ?? splatValue;
    if (traceValue !== undefined) {
      infoRecord.errorTrace = createErrorTrace(traceValue);
      infoRecord.error = serializeError(traceValue);
    } else if (callSiteTrace) {
      infoRecord.errorTrace = callSiteTrace;
    }
  }
  for (const key of Object.keys(info)) {
    const value = (info as Record<string, unknown>)[key];
    if (value instanceof Error) {
      (info as Record<string, unknown>)[key] = serializeError(value);
    } else if (ERROR_PAYLOAD_KEYS.has(key)) {
      (info as Record<string, unknown>)[key] = REDACTED;
    }
  }
  return info;
});

// msgpack has no cycle detection and throws on BigInt; break cycles and stringify BigInt first.
function decycle(value: unknown, ancestors: unknown[]): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return serializeError(value);
  if (typeof value !== 'object' || value === null) return value;
  if (ancestors.includes(value)) return '[Circular]';
  // msgpack encodes these natively; skip them or they'd flatten into {} / one key per byte.
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return value.toString('base64');
  if (ArrayBuffer.isView(value)) {
    const view = value as NodeJS.TypedArray;
    return Buffer.from(view.buffer, view.byteOffset, view.byteLength).toString('base64');
  }

  const nextAncestors = [...ancestors, value];
  if (value instanceof Map) {
    return decycle(Object.fromEntries(value), nextAncestors);
  }
  if (value instanceof Set) {
    return decycle([...value], nextAncestors);
  }
  if (Array.isArray(value)) {
    return value.map((item) => decycle(item, nextAncestors));
  }
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value)) {
    out[key] = decycle((value as Record<string, unknown>)[key], nextAncestors);
  }
  return out;
}

const sanitizeForFluent = winston.format((info) => decycle(info, []) as winston.Logform.TransformableInfo);

// Runs once at call time, before winston-transport's per-transport clone drops Error fields.
const sharedFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  normalizeErrors(),
  injectContext()
);

// sharedFormat's timestamp is UTC ISO for Fluent Bit; re-render local for console output.
function formatLocalTimestamp(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

const productionFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  return JSON.stringify({
    timestamp: typeof timestamp === 'string' ? formatLocalTimestamp(timestamp) : timestamp,
    level,
    message,
    ...meta,
  });
});

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, module, service, ...meta }) => {
    const context = module || service;
    const contextPrefix = context ? `[${context}] ` : '';
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    const time = typeof timestamp === 'string' ? formatLocalTimestamp(timestamp).slice(11) : timestamp;
    return `${time} ${level}: ${contextPrefix}${message}${metaString}`;
  })
);

// Streamed straight to Fluent Bit's forward input (docker/fluent-bit/) -- no file, no parser to sync.
const fluentFormat = winston.format.combine(sanitizeForFluent(), winston.format.json());

const transports: winston.transport[] = [
  new winston.transports.Console({
    format: config.env === 'development' || config.env === 'test' ? devFormat : productionFormat,
  }),
];

// fluent-logger sets a socket timeout but never handles it. Guard the connect phase only
// (removed on 'connect', per-socket) so idle established connections and replaced sockets are safe.
function guardSenderSocketTimeout(sender: { _socket: Socket | null }): void {
  let socket: Socket | null = null;
  Object.defineProperty(sender, '_socket', {
    configurable: true,
    get: () => socket,
    set: (next: Socket | null) => {
      socket = next;
      if (!next) return;
      const s = next;
      const onTimeout = () => {
        s.destroy(new Error('fluent socket connect timeout'));
      };
      s.once('timeout', onTimeout);
      s.once('connect', () => {
        s.removeListener('timeout', onTimeout);
      });
    },
  });
}

if (config.logging.fluent.enabled) {
  const FluentTransport = fluentLogger.support.winstonTransport();
  const fluentTransport = new FluentTransport('error.backend', {
    host: config.logging.fluent.host,
    port: config.logging.fluent.port,
    timeout: 10_000, // ms, not seconds; connect timeout only, see guardSenderSocketTimeout
    reconnectInterval: 30000,
    messageQueueSizeLimit: 1000, // bound memory when Fluent Bit is unreachable
    highWaterMark: 1000,
    level: 'error',
    format: fluentFormat,
  }) as winston.transport & {
    sender: { _socket: Socket | null };
    log: (info: winston.Logform.TransformableInfo, callback: (err?: unknown, ok?: boolean) => void) => void;
  };
  guardSenderSocketTimeout(fluentTransport.sender);

  // fluent-logger only calls back on delivery, so an outage stalls winston's Writable and
  // freezes Console too. Make it fire-and-forget; the sender has its own queue/reconnect.
  const deliverToSender = fluentTransport.log.bind(fluentTransport);
  fluentTransport.log = (info, callback) => {
    deliverToSender(info, () => {});
    callback();
  };

  transports.push(fluentTransport);
}

export const logger = winston.createLogger({
  level: config.logging.level,
  format: sharedFormat,
  transports,
  exitOnError: false,
  defaultMeta: {
    version: '1.0',
  },
});

const originalError = logger.error.bind(logger) as (...args: unknown[]) => winston.Logger;

const captureErrorLog = (...args: unknown[]): winston.Logger => {
  if (!args.some((arg) => findError(arg))) {
    const callSiteError = createCallSiteError(args[0], captureErrorLog);
    const lastArgument = args[args.length - 1];
    const callback = typeof lastArgument === 'function' ? args.pop() : undefined;
    const callSiteMetadata = { [CALL_SITE_TRACE_KEY]: createErrorTrace(callSiteError) };
    return callback
      ? originalError(...args, callSiteMetadata, callback)
      : originalError(...args, callSiteMetadata);
  }
  return originalError(...args);
};

logger.error = captureErrorLog as typeof logger.error;

export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};
