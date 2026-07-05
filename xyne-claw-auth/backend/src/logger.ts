/**
 * Structured JSON logging for xyne-claw-auth.
 *
 * Delegates to the shared logger in xyne-claw-shared so the whole claw stack
 * emits one identical JSON shape (parsed natively by VictoriaLogs). The
 * `createLogger(component, traceId)` API is preserved for existing call sites;
 * new code can also import `logger` / `loggerContext` directly.
 *
 * `service` is taken from SERVICE_NAME (set to "xyne-claw-auth" in this
 * deployment's env; also defaulted in main.ts for local dev).
 */
export {
  logger,
  loggerContext,
  createLogger,
  createTraceId,
  withLogContext,
  setLogContext,
} from "xyne-claw-shared";
export type { LogContext, Logger } from "xyne-claw-shared";
