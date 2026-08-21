export interface StorageLogger {
  info(message: string, ...meta: unknown[]): void;
  warn(message: string, ...meta: unknown[]): void;
  error(message: string, ...meta: unknown[]): void;
  debug?(message: string, ...meta: unknown[]): void;
}

// Log-forging guard (CWE-117 / js/log-injection): user-controlled values interpolated into a
// log message can carry CR/LF (or other control chars) to spoof additional log lines. Escape
// them in the message so a single log call can only ever produce a single, faithful line.
// Applied here so every consumer is protected regardless of which logger the host injects.
const escapeLogControlChars = (value: string): string =>
  // eslint-disable-next-line no-control-regex
  value.replace(/[\u0000-\u001f\u007f]/g, (char) => {
    if (char === '\n') return '\\n';
    if (char === '\r') return '\\r';
    if (char === '\t') return '\\t';
    return `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
  });

function guardLogInjection(base: StorageLogger): StorageLogger {
  const esc = (message: string): string =>
    typeof message === 'string' ? escapeLogControlChars(message) : message;
  return {
    info: (message, ...meta) => base.info(esc(message), ...meta),
    warn: (message, ...meta) => base.warn(esc(message), ...meta),
    error: (message, ...meta) => base.error(esc(message), ...meta),
    ...(base.debug ? { debug: (message, ...meta) => base.debug!(esc(message), ...meta) } : {}),
  };
}

export let logger: StorageLogger = guardLogInjection(console);

export function setStorageLogger(custom: StorageLogger): void {
  logger = guardLogInjection(custom);
}
