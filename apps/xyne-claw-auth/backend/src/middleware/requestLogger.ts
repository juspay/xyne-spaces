import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { logger, loggerContext, type LogContext } from "../logger.js";

/**
 * Endpoints that are machine-to-machine and fire many times a second, where the
 * access log tells an operator nothing they cannot get from the run itself.
 *
 * `/webhook/progress` is the loud one: claw posts a `stream_rate` telemetry
 * sample once per second for every streaming run, plus one per tool call, so a
 * couple of concurrent runs bury every other line in the log. The requests are
 * still served and still traced — only the start/end pair drops to `debug`.
 *
 * Override with QUIET_REQUEST_PATHS (comma-separated substrings); set it empty
 * to log everything again.
 */
const QUIET_REQUEST_PATHS: readonly string[] = (
  process.env["QUIET_REQUEST_PATHS"] ?? "/webhook/progress"
)
  .split(",")
  .map((entry) => entry.trim())
  .filter((entry) => entry.length > 0);

function isQuietPath(url: string): boolean {
  return QUIET_REQUEST_PATHS.some((quiet) => url.includes(quiet));
}

/**
 * Establishes an AsyncLocalStorage log context per request so every downstream
 * log line carries `requestId` (and `traceId`/`sessionId` when provided),
 * and emits structured request start/end with duration. Mirrors the xyne
 * backend's requestLogger (backend/src/middleware/requestLogger.ts).
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const context: LogContext = {
    requestId: (req.headers["x-request-id"] as string) || randomUUID().slice(0, 8),
  };
  const traceId = req.headers["x-trace-id"] as string | undefined;
  if (traceId) context.traceId = traceId;
  const sessionId = req.headers["x-session-id"] as string | undefined;
  if (sessionId) context.sessionId = sessionId;

  loggerContext.run(context, () => {
    const startedAt = Date.now();
    const level = isQuietPath(req.originalUrl || req.url) ? "debug" : "info";
    logger[level]("Request start", {
      component: "http",
      event: "request_start",
      method: req.method,
      url: req.url,
      ip: req.ip,
    });

    res.on("finish", () => {
      logger[level]("Request end", {
        component: "http",
        event: "request_end",
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });

    next();
  });
}
