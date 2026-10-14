import { createLogEntry } from './createLogEntry';
import type { LogFields, LogLevel, NormalizedLogFields, LogEventMap } from './types';
import type { LogTransport } from './transports/LogTransport';
import type { Clock } from './clock/Clock';
import { meetsMinimumLevel } from './logLevels';
import { normalizeLogFields } from './normalizeLogFields';
import { redactLogFields } from './redactLogFields';
import type { LogContextStore } from './context/LogContextStore';
import { attachRemoteOnlyLogFields } from './remote/remoteOnlyLogFields';

type LogEventName<TEventMap extends LogEventMap> = Extract<keyof TEventMap, string>;

type LogEventArguments<TEventFields extends LogFields | undefined> = [TEventFields] extends [
  undefined,
]
  ? []
  : [fields: Exclude<TEventFields, undefined>];

export type LoggerOptions = Readonly<{
  transports: readonly LogTransport[];
  clock: Clock;
  minimumLevel: LogLevel;
  context?: LogFields;
  contextStore?: LogContextStore;
  /** Keep email out of LogEntry.fields and attach it only in the remote serializer. */
  includeEmailInRemoteRecords?: boolean;
}>;

export class Logger<TEventMap extends LogEventMap> {
  private readonly transports: readonly LogTransport[];
  private readonly clock: Clock;
  private readonly minimumLevel: LogLevel;
  private readonly context: NormalizedLogFields;
  private readonly contextStore: LogContextStore | undefined;
  private readonly includeEmailInRemoteRecords: boolean;

  constructor(options: LoggerOptions) {
    this.transports = [...options.transports];
    this.clock = options.clock;
    this.minimumLevel = options.minimumLevel;
    this.context = normalizeLogFields(options.context ?? {});
    this.contextStore = options.contextStore;
    this.includeEmailInRemoteRecords = options.includeEmailInRemoteRecords ?? false;
  }

  withContext(context: LogFields): Logger<TEventMap> {
    const normalizedContext = normalizeLogFields(context);

    return new Logger<TEventMap>({
      transports: this.transports,
      clock: this.clock,
      minimumLevel: this.minimumLevel,
      context: {
        ...this.context,
        ...normalizedContext,
      },
      ...(this.contextStore !== undefined ? { contextStore: this.contextStore } : {}),
      includeEmailInRemoteRecords: this.includeEmailInRemoteRecords,
    });
  }

  debug<TEventName extends LogEventName<TEventMap>>(
    event: TEventName,
    ...[fields]: LogEventArguments<TEventMap[TEventName]>
  ): void {
    this.emit('debug', event, fields ?? {});
  }

  info<TEventName extends LogEventName<TEventMap>>(
    event: TEventName,
    ...[fields]: LogEventArguments<TEventMap[TEventName]>
  ): void {
    this.emit('info', event, fields ?? {});
  }

  warn<TEventName extends LogEventName<TEventMap>>(
    event: TEventName,
    ...[fields]: LogEventArguments<TEventMap[TEventName]>
  ): void {
    this.emit('warn', event, fields ?? {});
  }

  error<TEventName extends LogEventName<TEventMap>>(
    event: TEventName,
    ...[fields]: LogEventArguments<TEventMap[TEventName]>
  ): void {
    this.emit('error', event, fields ?? {});
  }

  private emit(level: LogLevel, event: string, fields: LogFields): void {
    if (!meetsMinimumLevel(level, this.minimumLevel)) {
      return;
    }

    const occurredAt = this.clock.now();

    const normalizedEventFields = normalizeLogFields(fields);

    const contextSnapshot: NormalizedLogFields = this.contextStore?.snapshot() ?? {};
    const combinedFields: NormalizedLogFields = {
      ...this.context,
      ...contextSnapshot,
      ...normalizedEventFields,
    };

    const redactedFields = redactLogFields(combinedFields);

    const entry = createLogEntry(level, event, redactedFields, occurredAt);
    const email = contextSnapshot['email'];
    const normalizedEmail = typeof email === 'string' ? email.trim() : '';
    if (this.includeEmailInRemoteRecords && normalizedEmail.length > 0) {
      attachRemoteOnlyLogFields(entry, { email: normalizedEmail });
    }

    for (const transport of this.transports) {
      try {
        transport.write(entry);
      } catch (error: unknown) {
        this.reportTransportFailure(transport, error);
      }
    }
  }

  private reportTransportFailure(transport: LogTransport, error: unknown): void {
    try {
      console.error(`[Logger] Transport "${transport.name}" failed to write a log entry.`, error);
    } catch {
      // Internal logging diagnostics must never interrupt app behavior.
    }
  }
}
