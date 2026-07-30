export interface ErrorTrace {
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  codeFrames: Array<{ function: string; file: string; line: number; column: number }>;
  fingerprint: string;
  runtime: 'dashboard';
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
const workspaceFrame = (file: string): boolean =>
  /(?:^|\/)(?:apps\/dashboard\/src|dashboard\/src|src)\//.test(file.replace(/\\/g, '/'));
const redact = (value: string): string =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    );

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const valueMessage = (value: unknown): string => {
  if (typeof value === 'string') return redact(value).slice(0, MAX_MESSAGE_LENGTH);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return Object.prototype.toString.call(value);
};

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
    if (typeof payload.stack === 'string' && payload.stack.length > 3) {
      payload.stack = truncate(payload.stack, Math.max(3, payload.stack.length - 1_000));
      continue;
    }
    if ('cause' in payload) {
      delete payload.cause;
      continue;
    }
    break;
  }
  return payload;
};

export const serializeError = (value: unknown, depth = 0): Record<string, unknown> => {
  if (!(value instanceof Error)) return { name: 'NonError', message: valueMessage(value) };

  const serialized: Record<string, unknown> = {
    name: value.name,
    message: redact(value.message).slice(0, MAX_MESSAGE_LENGTH),
    stack: value.stack ? truncate(redact(value.stack), MAX_STACK_LENGTH) : undefined,
  };
  for (const field of SAFE_FIELDS) {
    const fieldValue = (value as unknown as Record<string, unknown>)[field];
    if (typeof fieldValue === 'string' || typeof fieldValue === 'number') {
      serialized[field] = fieldValue;
    }
  }
  const cause = (value as Error & { cause?: unknown }).cause;
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH) {
    serialized.cause = serializeError(cause, depth + 1);
  }
  return fitSerializedPayload(serialized);
};

export const createErrorTrace = (value: unknown): ErrorTrace => {
  const error = value instanceof Error ? value : new Error(valueMessage(value));
  const stack = error.stack ? truncate(redact(error.stack), MAX_STACK_LENGTH) : undefined;
  const codeFrames = (stack ?? '')
    .split('\n')
    .slice(1)
    .map(line => line.match(chromeFramePattern) ?? line.match(firefoxFramePattern))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => ({
      function: truncate(match[1] || '<anonymous>', MAX_FRAME_FUNCTION_LENGTH),
      file: truncate(match[2].replace(/^file:\/\//, ''), MAX_FRAME_FILE_LENGTH),
      line: Number(match[3]),
      column: Number(match[4]),
    }))
    .filter(frame => workspaceFrame(frame.file))
    .slice(0, MAX_FRAMES);
  const identity = [
    error.name,
    error.message.replace(/\d+/g, '#'),
    ...codeFrames.slice(0, 5).map(frame => `${frame.function}:${frame.file}`),
  ].join('|');
  return {
    errorName: error.name,
    errorMessage: redact(error.message).slice(0, MAX_MESSAGE_LENGTH),
    errorStack: stack,
    codeFrames,
    fingerprint: `${stableHash(identity)}${stableHash(identity.slice(1))}${stableHash(identity.slice(2))}`,
    runtime: 'dashboard',
  };
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
