import winston from "winston";
import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";

/**
 * Structured JSON logger shared across the claw backend services
 * (xyne-claw and xyne-claw-auth). Mirrors the xyne backend's logger
 * (backend/src/utils/logger.ts): winston with a JSON production format and an
 * AsyncLocalStorage context so correlation ids (requestId, traceId, userId, …)
 * are injected into every line within a request/run.
 *
 * One JSON object per line on stdout/stderr → fluent-bit → VictoriaLogs parses
 * every field natively. No logging bridge is needed: claw runs server-side, so
 * its stdout is scraped automatically (the bridge only exists for client apps).
 *
 * `service` distinguishes the emitting process and is taken from SERVICE_NAME
 * (set per deployment: "xyne-claw" vs "xyne-claw-auth").
 */

export interface LogContext {
  requestId?: string;
  traceId?: string;
  conversationId?: string;
  sessionId?: string;
  runId?: string;
  userId?: string;
  userEmail?: string;
  agentSlug?: string;
}

export const loggerContext = new AsyncLocalStorage<LogContext>();

/** Run `fn` with `ctx` merged on top of any inherited context. */
export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  const parent = loggerContext.getStore() ?? {};
  return loggerContext.run({ ...parent, ...ctx }, fn);
}

/** Merge fields into the current context in place (for ids learned mid-run). */
export function setLogContext(ctx: LogContext): void {
  const store = loggerContext.getStore();
  if (store) Object.assign(store, ctx);
}

export function createTraceId(): string {
  return crypto.randomUUID().slice(0, 8);
}

const injectContext = winston.format((info) => {
  // Resolve `service` at log time so SERVICE_NAME can be set per deployment
  // (xyne-claw vs xyne-claw-auth) without import-order fragility.
  if (!info.service) info.service = process.env.SERVICE_NAME || "xyne-claw";
  const context = loggerContext.getStore();
  if (context) Object.assign(info, context);
  return info;
});

// Capture extra positional args (winston SPLAT) into a `details` field so that
// a mechanical `console.x(a, b)` → `log.x(a, b)` migration never drops the
// second arg. Errors are expanded; a single object 2nd arg is merged by winston
// directly (no splat) and so still lands as top-level fields.
const SPLAT = Symbol.for("splat");
const captureSplat = winston.format((info) => {
  const splat = (info as Record<symbol, unknown>)[SPLAT];
  if (Array.isArray(splat) && splat.length > 0) {
    // Only keep args winston would otherwise drop: primitives, Errors, arrays.
    // A single plain-object 2nd arg is already merged into top-level fields by
    // winston, so excluding it here avoids duplicating structured meta.
    const extras = splat.filter(
      (s) => s instanceof Error || Array.isArray(s) || s === null || typeof s !== "object",
    );
    if (extras.length > 0) {
      info.details = extras.map((s) =>
        s instanceof Error ? { name: s.name, message: s.message, stack: s.stack } : s,
      );
    }
  }
  return info;
});

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/(\bapi[_-]?key\b["'\s]*[:=]\s*["']?)([A-Za-z0-9_\-]{12,})/gi, "$1<redacted>"],
  [/\bsk-[A-Za-z0-9]{16,}\b/g, "sk-<redacted>"],
  [/(\b[Bb]earer\s+)[A-Za-z0-9._\-]{16,}/g, "$1<redacted>"],
];

function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

function redactValue(v: unknown): unknown {
  if (typeof v === "string") return redactString(v);
  if (Array.isArray(v)) return v.map(redactValue);
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) out[k] = redactValue(val);
    return out;
  }
  return v;
}

const redactSecrets = winston.format((info) => {
  if (typeof info.message === "string") info.message = redactString(info.message);
  for (const key of Object.keys(info)) {
    if (key === "message" || key === "level" || key === "timestamp") continue;
    (info as Record<string, unknown>)[key] = redactValue((info as Record<string, unknown>)[key]);
  }
  return info;
});

const productionFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  captureSplat(),
  injectContext(),
  redactSecrets(),
  winston.format.printf(({ timestamp, level, message, ...meta }) =>
    JSON.stringify({ timestamp, level, message, ...meta }),
  ),
);

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  captureSplat(),
  injectContext(),
  redactSecrets(),
  winston.format.printf(({ timestamp, level, message, component, service, ...meta }) => {
    const ctx = component || service;
    const prefix = ctx ? `[${ctx}] ` : "";
    const metaString = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
    return `${timestamp} ${level}: ${prefix}${message}${metaString}`;
  }),
);

const isDev = process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: isDev ? devFormat : productionFormat,
  transports: [new winston.transports.Console()],
  exitOnError: false,
  defaultMeta: {
    version: "1.0",
    service: process.env.SERVICE_NAME || "xyne-claw",
  },
});

export type Logger = winston.Logger;

/**
 * Compatibility wrapper for the existing `createLogger(component, traceId)`
 * call sites in xyne-claw-auth. Returns a child logger that stamps `component`
 * (and optional `traceId`) on every line.
 */
export function createLogger(component: string, traceId?: string): winston.Logger {
  return logger.child(traceId ? { component, traceId } : { component });
}
