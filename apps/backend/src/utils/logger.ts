import winston from 'winston';
import { AsyncLocalStorage } from 'async_hooks';
import fluentLogger from 'fluent-logger';
import { config } from '@/config/env';

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

const SAFE_ERROR_FIELDS = ['code', 'status', 'statusCode', 'errno', 'syscall'] as const;
const ERROR_PAYLOAD_KEYS = new Set(['config', 'request', 'response', 'headers', 'options']);
const REDACTED = '[REDACTED]';

export function serializeError(err: Error): Record<string, unknown> {
  const out: Record<string, unknown> = {
    name: err.name,
    message: err.message,
    stack: err.stack,
  };
  for (const field of SAFE_ERROR_FIELDS) {
    const value = (err as unknown as Record<string, unknown>)[field];
    if (typeof value === 'string' || typeof value === 'number') {
      out[field] = value;
    }
  }
  return out;
}

const normalizeErrors = winston.format((info) => {
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

// fluent-logger's msgpack encoder has no cycle detection and throws on BigInt;
// break cycles and stringify BigInt before anything reaches it.
const sanitizeForFluent = winston.format((info) => {
  const seen = new WeakSet<object>();
  return JSON.parse(
    JSON.stringify(info, (_key, value) => {
      if (typeof value === 'bigint') return value.toString();
      if (value instanceof Error) return serializeError(value);
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) return '[Circular]';
        seen.add(value);
      }
      return value;
    })
  );
});

// Runs once at call time, before winston-transport clones `info` per
// transport -- that clone drops non-enumerable Error fields and can happen
// asynchronously under a different request's AsyncLocalStorage context.
const sharedFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  normalizeErrors(),
  injectContext()
);

const productionFormat = winston.format.printf(({ timestamp, level, message, ...meta }) => {
  return JSON.stringify({
    timestamp,
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
    const time = typeof timestamp === 'string' ? timestamp.slice(11) : timestamp;
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

if (config.logging.fluent.enabled) {
  const FluentTransport = fluentLogger.support.winstonTransport();
  transports.push(
    new FluentTransport('error.backend', {
      host: config.logging.fluent.host,
      port: config.logging.fluent.port,
      timeout: 3000, // ms, not seconds
      reconnectInterval: 30000,
      messageQueueSizeLimit: 1000, // bound memory when Fluent Bit is unreachable
      highWaterMark: 1000, // avoid backpressure freezing the Console transport too
      level: 'error',
      format: fluentFormat,
    }) as winston.transport
  );
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

export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
}; 
