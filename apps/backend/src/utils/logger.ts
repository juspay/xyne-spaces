import winston from 'winston';
import { AsyncLocalStorage } from 'async_hooks';
import fluentLogger from 'fluent-logger';
import type { Socket } from 'net';
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

const ERROR_PAYLOAD_KEYS = new Set(['config', 'request', 'response', 'headers', 'options']);
const REDACTED = '[REDACTED]';
const MAX_LIBRARY_STACK_FRAMES = 3;
const SAFE_ERROR_FIELDS = ['code', 'status', 'statusCode', 'errno', 'syscall'] as const;

const redact = (value: string): string =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]'
    );

const isLibraryStackFrame = (line: string): boolean =>
  /(?:[/\\]node_modules[/\\]|\bnode:[^)\s]+|\bat (?:async )?internal[/\\])/.test(line);

export const limitLibraryStackFrames = (stack: string): string => {
  let libraryFrames = 0;

  return stack
    .split('\n')
    .filter((line, index) => {
      if (index === 0 || !isLibraryStackFrame(line)) return true;
      libraryFrames += 1;
      return libraryFrames <= MAX_LIBRARY_STACK_FRAMES;
    })
    .join('\n');
};

const stackFor = (error: Error): string | undefined =>
  error.stack ? redact(limitLibraryStackFrames(error.stack)) : undefined;

const findError = (value: unknown, depth = 0): Error | undefined => {
  if (value instanceof Error) return value;
  if (!value || typeof value !== 'object') return undefined;

  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (ERROR_PAYLOAD_KEYS.has(key)) continue;
    if (item instanceof Error) return item;
    if (depth === 0) {
      const nestedError = findError(item, depth + 1);
      if (nestedError) return nestedError;
    }
  }
  return undefined;
};

export function serializeError(value: unknown): Record<string, unknown> {
  if (!(value instanceof Error)) {
    return {
      name: 'NonError',
      message: redact(typeof value === 'string' ? value : String(value)),
    };
  }

  const serialized: Record<string, unknown> = {
    name: value.name,
    message: redact(value.message),
    stack: stackFor(value),
  };
  for (const field of SAFE_ERROR_FIELDS) {
    const fieldValue = (value as unknown as Record<string, unknown>)[field];
    if (typeof fieldValue === 'string' || typeof fieldValue === 'number') {
      serialized[field] = fieldValue;
    }
  }
  return serialized;
}

/**
 * Keep global rejection handlers safe even when a promise is rejected with an
 * arbitrary object. Passing that object to Winston directly can make its JSON
 * formatter throw (for example, when the value contains a circular reference).
 */
export function describeRejection(reason: unknown): Record<string, unknown> {
  if (reason instanceof Error) return serializeError(reason);

  let value: string;
  try {
    value = typeof reason === 'object' ? Object.prototype.toString.call(reason) : String(reason);
  } catch {
    value = '[Unrepresentable value]';
  }

  return {
    message: 'Non-error rejection',
    type: typeof reason,
    value,
  };
}

const normalizeErrors = winston.format((info) => {
  const infoRecord = info as Record<string, unknown>;
  if (typeof infoRecord.stack === 'string') {
    infoRecord.stack = redact(limitLibraryStackFrames(infoRecord.stack));
  }

  for (const key of Object.keys(info)) {
    const value = infoRecord[key];
    if (value instanceof Error) {
      infoRecord[key] = serializeError(value);
    } else if (ERROR_PAYLOAD_KEYS.has(key)) {
      infoRecord[key] = REDACTED;
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

const escapeLogControlChars = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\u0000-\u001f\u007f]/g, (char) => {
    if (char === "\n") return "\\n";
    if (char === "\r") return "\\r";
    if (char === "\t") return "\\t";
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });

const sanitizeLogMessage = winston.format((info) => {
  if (typeof info.message === 'string') {
    info.message = escapeLogControlChars(info.message);
  }
  return info;
});

const sanitizeForFluent = winston.format((info) => decycle(info, []) as winston.Logform.TransformableInfo);

// Runs once at call time, before winston-transport's per-transport clone drops Error fields.
const sharedFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.errors({ stack: true }),
  normalizeErrors(),
  sanitizeLogMessage(),
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
    const message = typeof args[0] === 'string' ? args[0] : String(args[0]);
    const callSiteError = new Error(message);
    Error.captureStackTrace?.(callSiteError, captureErrorLog);
    const lastArgument = args[args.length - 1];
    const callback = typeof lastArgument === 'function' ? args.pop() : undefined;
    const stack = stackFor(callSiteError);

    if (args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
      const info = args[0] as Record<string, unknown>;
      args[0] = { ...info, stack: info['stack'] ?? stack };
    } else if (args[1] && typeof args[1] === 'object' && !Array.isArray(args[1])) {
      // Winston only merges the first splat object into the log info. Put the
      // captured stack into that object instead of appending a second one.
      const metadata = args[1] as Record<string, unknown>;
      args[1] = { ...metadata, stack: metadata['stack'] ?? stack };
    } else {
      args.push({ stack });
    }

    return callback ? originalError(...args, callback) : originalError(...args);
  }
  return originalError(...args);
};

logger.error = captureErrorLog as typeof logger.error;

export const stream = {
  write: (message: string) => {
    logger.info(message.trim());
  },
};
