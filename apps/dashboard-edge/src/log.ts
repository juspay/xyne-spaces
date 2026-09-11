// JSON-lines logger on stdout, one object per line so the existing log
// shipping picks the fields up. Level is set from config at startup.
type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold = LEVELS.info;

export function setLogLevel(level: string): void {
  threshold = LEVELS[level as Level] ?? LEVELS.info;
}

function serializeError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return { message: err.message, name: err.name, stack: err.stack };
  }
  return { message: String(err) };
}

function write(level: Level, msg: string, fields?: Record<string, unknown>): void {
  if (LEVELS[level] < threshold) {
    return;
  }
  const record: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
  if (fields) {
    for (const [key, value] of Object.entries(fields)) {
      record[key] = key === 'err' ? serializeError(value) : value;
    }
  }
  process.stdout.write(`${JSON.stringify(record)}\n`);
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>): void => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>): void => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>): void => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>): void => write('error', msg, fields),
};
