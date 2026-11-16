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
  redactUrlQuery,
} from "xyne-claw-shared";
export type { LogContext, Logger } from "xyne-claw-shared";

import { redactUrlQuery } from "xyne-claw-shared";

// Connect and hosted-file links carry a bearer token as a path segment:
// /surfaces/<channel>/connect/<token>[/done] and /surfaces/<channel>/files/<token>.
const TOKEN_PATH = /(\/surfaces\/[^/?#]+\/(?:connect|files)\/)[^/?#]+/;

/** Request URL safe for logs: query values and link tokens masked. */
export function logUrl(url: string): string {
  return redactUrlQuery(url).replace(TOKEN_PATH, "$1[REDACTED]");
}
