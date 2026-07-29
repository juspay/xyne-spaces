import winston from 'winston';
import { AsyncLocalStorage } from 'async_hooks';
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

const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  normalizeErrors(),
  injectContext(),
  winston.format.json(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    return JSON.stringify({
      timestamp,
      level,
      message,
      ...meta,
    });
  })
);


const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'HH:mm:ss' }),
  winston.format.errors({ stack: true }),
  normalizeErrors(),
  injectContext(),
  winston.format.printf(({ timestamp, level, message, module, service, ...meta }) => {
    const context = module || service;
    const contextPrefix = context ? `[${context}] ` : '';
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} ${level}: ${contextPrefix}${message}${metaString}`;
  })
);

export const logger = winston.createLogger({
  level: config.logging.level,
  format: config.env === 'development' || config.env === 'test' ? devFormat : productionFormat,
  transports: [new winston.transports.Console()],
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
