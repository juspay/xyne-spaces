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
  [/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "[REDACTED_JWT]"],
];

// Compared after lower-casing and stripping `_` / `-`.
const SECRET_KEYS = new Set([
  "password",
  "passwd",
  "secret",
  "clientsecret",
  "token",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "apikey",
  "xapikey",
  "authorization",
  "cookie",
  "cookies",
  "setcookie",
  "privatekey",
  "signingsecret",
  "sessiontoken",
]);

// HTTP-client errors (axios, gaxios, @kubernetes/client-node) carry the full
// request incl. auth headers under these keys; winston spreads a sole Error
// meta's own props onto the top level of the info object.
const DROPPED_TOP_LEVEL_KEYS = new Set(["config", "request", "response", "headers"]);

const MAX_REDACT_DEPTH = 10;
const REDACTED = "[REDACTED]";

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key.toLowerCase().replace(/[_-]/g, ""));
}

function redactString(s: string): string {
  let out = s;
  for (const [re, rep] of SECRET_PATTERNS) out = out.replace(re, rep);
  return out;
}

/** Replaces every query parameter value (and drops any fragment / userinfo) in a URL or path. */
export function redactUrlQuery(url: string): string {
  const withoutFragment = url.split("#")[0] ?? "";
  const withoutUserinfo = withoutFragment.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^/?@]*@/i, `$1${REDACTED}@`);
  const q = withoutUserinfo.indexOf("?");
  if (q === -1) return withoutUserinfo;
  const query = withoutUserinfo
    .slice(q + 1)
    .split("&")
    .map((pair) => {
      const eq = pair.indexOf("=");
      return eq === -1 ? pair : `${pair.slice(0, eq)}=${REDACTED}`;
    })
    .join("&");
  return `${withoutUserinfo.slice(0, q)}?${query}`;
}

export function redactValue(v: unknown, depth = 0, ancestors: WeakSet<object> = new WeakSet()): unknown {
  if (typeof v === "string") return redactString(v);
  if (!v || typeof v !== "object") return v;
  if (v instanceof Error) {
    return {
      name: v.name,
      message: redactString(v.message),
      stack: v.stack === undefined ? undefined : redactString(v.stack),
    };
  }
  if (ancestors.has(v)) return "[Circular]";
  if (depth >= MAX_REDACT_DEPTH) return "[Truncated]";
  ancestors.add(v);
  let out: unknown;
  if (Array.isArray(v)) {
    out = v.map((item) => redactValue(item, depth + 1, ancestors));
  } else {
    const obj: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      obj[k] =
        isSecretKey(k) && (typeof val === "string" || (val && typeof val === "object"))
          ? REDACTED
          : redactValue(val, depth + 1, ancestors);
    }
    out = obj;
  }
  ancestors.delete(v);
  return out;
}

export function redactLogInfo<T extends object>(info: T): T {
  const fields = info as Record<string, unknown>;
  if (typeof fields.message === "string") fields.message = redactString(fields.message);
  for (const key of Object.keys(fields)) {
    if (key === "message" || key === "level" || key === "timestamp") continue;
    const val = fields[key];
    if (DROPPED_TOP_LEVEL_KEYS.has(key) && val && typeof val === "object") {
      fields[key] = REDACTED;
    } else if (isSecretKey(key) && (typeof val === "string" || (val && typeof val === "object"))) {
      fields[key] = REDACTED;
    } else {
      fields[key] = redactValue(val);
    }
  }
  return info;
}

const redactSecrets = winston.format((info) => redactLogInfo(info));

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
