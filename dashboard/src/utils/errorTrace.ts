export interface ErrorTrace {
  errorName: string;
  errorMessage: string;
  errorStack?: string;
  codeFrames: Array<{ function: string; file: string; line: number; column: number }>;
  fingerprint: string;
  runtime: 'dashboard' | 'dashboard-in-electron';
}

const MAX_FRAMES = 20;
const MAX_CAUSE_DEPTH = 3;
const MAX_MESSAGE_LENGTH = 1_000;
const MAX_STACK_LENGTH = 6_000;
const MAX_SERIALIZED_BYTES = 16_000;
const MAX_FRAME_FUNCTION_LENGTH = 120;
const MAX_FRAME_FILE_LENGTH = 240;
const framePattern = /^\s*at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/;
const redact = (value: string): string =>
  value
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [REDACTED]')
    .replace(
      /\b(authorization|token|password|secret|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi,
      '$1=[REDACTED]',
    );

const messageFor = (value: unknown): string => {
  if (typeof value === 'string') return redact(value).slice(0, MAX_MESSAGE_LENGTH);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  return Object.prototype.toString.call(value);
};

const truncate = (value: string, maxLength: number): string =>
  value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;

const fitSerializedPayload = (payload: Record<string, unknown>): Record<string, unknown> => {
  const byteLength = (): number => new TextEncoder().encode(JSON.stringify(payload)).length;
  while (byteLength() > MAX_SERIALIZED_BYTES) {
    if (typeof payload['stack'] === 'string' && payload['stack'].length > 3) {
      payload['stack'] = truncate(payload['stack'], Math.max(3, payload['stack'].length - 1_000));
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
  if (!(value instanceof Error)) return { name: 'NonError', message: messageFor(value) };
  const result: Record<string, unknown> = {
    name: value.name,
    message: redact(value.message).slice(0, MAX_MESSAGE_LENGTH),
    stack: value.stack ? truncate(redact(value.stack), MAX_STACK_LENGTH) : undefined,
  };
  const cause = (value as Error & { cause?: unknown }).cause;
  if (cause !== undefined && depth < MAX_CAUSE_DEPTH)
    result['cause'] = serializeError(cause, depth + 1);
  return fitSerializedPayload(result);
};

export const findError = (fields: Record<string, unknown>): Error | undefined => {
  if (fields['error'] instanceof Error) return fields['error'];
  return Object.values(fields).find(value => value instanceof Error) as Error | undefined;
};

export const createErrorTrace = (value: unknown): ErrorTrace => {
  const error = value instanceof Error ? value : new Error(messageFor(value));
  const stack = error.stack ? truncate(redact(error.stack), MAX_STACK_LENGTH) : undefined;
  const codeFrames = (stack ?? '')
    .split('\n')
    .slice(1)
    .map(line => line.match(framePattern))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map(match => ({
      function: truncate(match[1] || '<anonymous>', MAX_FRAME_FUNCTION_LENGTH),
      file: truncate(match[2] ?? '', MAX_FRAME_FILE_LENGTH),
      line: Number(match[3] ?? 0),
      column: Number(match[4] ?? 0),
    }))
    .filter(frame => /(?:^|\/)dashboard\/src\//.test(frame.file.replace(/\\/g, '/')))
    .slice(0, MAX_FRAMES);
  const identity = [
    error.name,
    error.message.replace(/\d+/g, '#'),
    ...codeFrames.slice(0, 5).map(frame => `${frame.function}:${frame.file}`),
  ].join('|');
  let hash = 0x811c9dc5;
  for (let index = 0; index < identity.length; index++)
    hash = Math.imul(hash ^ identity.charCodeAt(index), 0x01000193);
  const trace: ErrorTrace = {
    errorName: error.name,
    errorMessage: redact(error.message).slice(0, MAX_MESSAGE_LENGTH),
    codeFrames,
    fingerprint: (hash >>> 0).toString(16).padStart(8, '0'),
    runtime: window.electronAPI ? 'dashboard-in-electron' : 'dashboard',
  };
  if (stack !== undefined) {
    trace.errorStack = stack;
  }
  return trace;
};
