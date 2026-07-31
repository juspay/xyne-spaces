export interface ErrorTraceFrame {
  function: string;
  file: string;
  line: number;
  column: number;
}

export interface ErrorTrace<Runtime extends string = string> {
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  codeFrames: ErrorTraceFrame[];
  fingerprint: string;
  runtime: Runtime;
}

export interface CreateErrorTraceOptions<Runtime extends string> {
  runtime: Runtime;
  isWorkspaceFrame: (file: string) => boolean;
}

const MAX_FRAMES = 20;
const MAX_CAUSE_DEPTH = 3;
const MAX_MESSAGE_LENGTH = 1_000;
const MAX_STACK_LENGTH = 6_000;
const MAX_SERIALIZED_CHARS = 16_000;
const MAX_FRAME_FUNCTION_LENGTH = 120;
const MAX_FRAME_FILE_LENGTH = 240;
const SENSITIVE_KEYS = new Set(['config', 'request', 'response', 'headers', 'options']);
const SAFE_FIELDS = ['code', 'status', 'statusCode', 'errno', 'syscall'] as const;

const chromeFramePattern = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const firefoxFramePattern = /^(.*?)@(.+?):(\d+):(\d+)$/;

export const redactErrorTraceValue = (value: string): string =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    );

export const errorTraceMessage = (value: unknown): string => {
  if (typeof value === 'string') return redactErrorTraceValue(value).slice(0, MAX_MESSAGE_LENGTH);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return Object.prototype.toString.call(value);
};

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const stableHash = (value: string): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const fitSerializedPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  while (JSON.stringify(payload).length > MAX_SERIALIZED_CHARS) {
    const stack = payload['stack'];
    if (typeof stack === 'string' && stack.length > 3) {
      payload['stack'] = truncate(stack, Math.max(3, stack.length - 1_000));
      continue;
    }
    if ('cause' in payload) {
      delete payload['cause'];
      continue;
    }
    break;
  }
  return payload;
};

export const serializeError = (value: unknown, depth = 0): Record<string, unknown> => {
  if (!(value instanceof Error)) return { name: 'NonError', message: errorTraceMessage(value) };

  const serialized: Record<string, unknown> = {
    name: value.name,
    message: redactErrorTraceValue(value.message).slice(0, MAX_MESSAGE_LENGTH),
  };
  if (value.stack) {
    serialized['stack'] = redactErrorTraceValue(truncate(value.stack, MAX_STACK_LENGTH));
  }
  for (const field of SAFE_FIELDS) {
    const fieldValue = (value as unknown as Record<string, unknown>)[field];
    if (typeof fieldValue === 'string' || typeof fieldValue === 'number') {
      serialized[field] = fieldValue;
    }
  }
  const cause = (value as Error & { cause?: unknown }).cause;
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    serialized['cause'] = serializeError(cause, depth + 1);
  }
  return fitSerializedPayload(serialized);
};

const parseStackFrames = (
  stack: string | undefined,
  isWorkspaceFrame: (file: string) => boolean,
): ErrorTraceFrame[] => {
  if (!stack) return [];
  const frames: ErrorTraceFrame[] = [];
  const lines = stack.split('\n');
  for (let index = 1; index < lines.length && frames.length < MAX_FRAMES; index += 1) {
    const line = lines[index];
    if (line === undefined) continue;
    const match = line.match(chromeFramePattern) ?? line.match(firefoxFramePattern);
    if (!match) continue;
    const file = truncate((match[2] ?? '').replace(/^file:\/\//, ''), MAX_FRAME_FILE_LENGTH);
    if (!isWorkspaceFrame(file)) continue;
    frames.push({
      function: truncate(match[1] || '<anonymous>', MAX_FRAME_FUNCTION_LENGTH),
      file,
      line: Number(match[3]),
      column: Number(match[4]),
    });
  }
  return frames;
};

export const createErrorTrace = <Runtime extends string>(
  value: unknown,
  options: CreateErrorTraceOptions<Runtime>,
): ErrorTrace<Runtime> => {
  const error = value instanceof Error ? value : new Error(errorTraceMessage(value));
  const stack = error.stack ? redactErrorTraceValue(truncate(error.stack, MAX_STACK_LENGTH)) : undefined;
  const codeFrames = parseStackFrames(stack, options.isWorkspaceFrame);
  const identity = [
    error.name,
    error.message.replace(/\d+/g, '#'),
    ...codeFrames.slice(0, 5).map(frame => `${frame.function}:${frame.file}`),
  ].join('|');
  const trace: ErrorTrace<Runtime> = {
    errorName: error.name,
    errorMessage: redactErrorTraceValue(error.message).slice(0, MAX_MESSAGE_LENGTH),
    codeFrames,
    fingerprint: `${stableHash(identity)}${stableHash(identity.slice(1))}${stableHash(identity.slice(2))}`,
    runtime: options.runtime,
  };
  if (stack !== undefined) {
    trace.errorStack = stack;
  }
  return trace;
};

export const createCallSiteError = (message: unknown, exclude?: Function): Error => {
  const error = new Error(errorTraceMessage(message));
  Error.captureStackTrace?.(error, exclude ?? createCallSiteError);
  return error;
};

export const findError = (value: unknown, depth = 0): Error | undefined => {
  if (value instanceof Error) return value;
  if (!value || typeof value !== 'object') return undefined;
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEYS.has(key)) continue;
    if (item instanceof Error) return item;
    if (depth === 0) {
      const nestedError = findError(item, depth + 1);
      if (nestedError) return nestedError;
    }
  }
  return undefined;
};
