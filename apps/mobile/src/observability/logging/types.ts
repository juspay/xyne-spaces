export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, unknown>>;

export type LogEventMap = Readonly<Record<string, LogFields | undefined>>;

export type DefineLogEventMap<TEventMap extends LogEventMap> = TEventMap;

export type JsonPrimitive = string | number | boolean | null;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

export type NormalizedLogFields = JsonObject;

export type LogEntry = Readonly<{
  timestamp: string;
  level: LogLevel;
  event: string;
  fields: NormalizedLogFields;
}>;
