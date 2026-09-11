// @xyne/logger core types. Compile-time: LogPayload bans secret key names (a
// nudge). Runtime: the shredder is the real boundary. PII is allowed on purpose
// (the frozen Grafana contract needs it — PRD "Case A").

/** A JSON-serialisable value. */
export type LogValue =
  | string
  | number
  | boolean
  | null
  | LogValue[]
  | { [key: string]: LogValue };

/** Key names banned at compile time. Keep aligned with `SECRET_KEY_RE` in shredder.ts. */
export type SecretKey =
  | "password"
  | "token"
  | "apiKey"
  | "secret"
  | "authorization"
  | "cookie"
  | "privateKey"
  | "clientSecret"
  | "jwt";

/** Reject every secret key at compile time. */
export type ForbidSecrets<T> = T & { [K in SecretKey]?: never };

/** Log-call fields. Any field name allowed (frozen contract fields are just strings) except secrets. */
export type LogPayload = ForbidSecrets<{ [field: string]: LogValue | undefined }>;

export type LogLevel = "debug" | "info" | "warn" | "error";

/** Env-agnostic logger surface; each repo logger becomes a thin adapter over it. */
export interface Logger {
  event(name: string, fields?: LogPayload): void;
  debug(message: string, fields?: LogPayload): void;
  info(message: string, fields?: LogPayload): void;
  warn(message: string, fields?: LogPayload): void;
  error(message: string, err?: unknown, fields?: LogPayload): void;
}

/** Supplies ambient fields (requestId, emailId, …) merged into every record. */
export interface ContextProvider {
  /** Current ambient fields, or undefined when no context is active. */
  get(): LogPayload | undefined;
}
