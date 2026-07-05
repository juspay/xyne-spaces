import type { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { logger, loggerContext, type LogContext } from "../logger.js";

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
    logger.info("Request start", {
      component: "http",
      event: "request_start",
      method: req.method,
      url: req.url,
      ip: req.ip,
    });

    res.on("finish", () => {
      logger.info("Request end", {
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
