/**
 * Structured JSON logging for xyne-claw — delegates to the shared logger in
 * xyne-claw-shared so the whole claw stack emits one identical JSON shape.
 * `service` comes from SERVICE_NAME ("xyne-claw", defaulted in main.ts).
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
