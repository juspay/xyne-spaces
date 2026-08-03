const MAX_ERROR_MESSAGE_LENGTH = 2_000;
const MAX_ERROR_STACK_LENGTH = 8_000;

export interface DpipLogContext {
  requestId?: string;
}

type LogFields = Record<string, unknown>;

function truncate(value: string, maximumLength: number): string {
  if (value.length <= maximumLength) {
    return value;
  }
  return `${value.slice(0, maximumLength)}…[truncated]`;
}

function errorCode(error: Error): string | undefined {
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' || typeof code === 'number'
    ? String(code)
    : undefined;
}

export function errorLogFields(error: unknown): LogFields {
  if (!(error instanceof Error)) {
    return { error_type: 'UnknownError' };
  }

  const code = errorCode(error);
  return {
    error_type: error.constructor.name,
    error_message: truncate(error.message, MAX_ERROR_MESSAGE_LENGTH),
    ...(code === undefined ? {} : { error_code: code }),
    ...(error.stack === undefined
      ? {}
      : { error_stack: truncate(error.stack, MAX_ERROR_STACK_LENGTH) }),
  };
}

export function contextLogFields(context?: DpipLogContext): LogFields {
  return context?.requestId === undefined
    ? {}
    : { request_id: context.requestId };
}

function stringify(entry: LogFields): string {
  return JSON.stringify(entry, (_key, value: unknown) =>
    typeof value === 'bigint' ? value.toString() : value,
  );
}

export function logInfo(event: string, fields: LogFields = {}): void {
  console.log(stringify({ severity: 'INFO', event, ...fields }));
}

export function logWarning(
  event: string,
  fields: LogFields = {},
): void {
  console.warn(stringify({ severity: 'WARNING', event, ...fields }));
}

export function logError(event: string, fields: LogFields = {}): void {
  console.error(stringify({ severity: 'ERROR', event, ...fields }));
}
