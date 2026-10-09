// The shredder — one denylist redaction pass for every log record (PRD R3/R4).
// Redacts secret VALUES only (field names kept => frozen Grafana contract intact)
// via two detectors: by KEY (secret-named field) and by VALUE (secret-shaped
// string). Cycle-safe, size-capped, control-char scrubbed, and never throws.
// Exceptions to the KEY detector come from the Superposition allow-list
// (see policy.ts); nothing is allow-listed in code.

import { allowedPathsFor } from "./policy.js";

export interface ShredOptions {
  /**
   * Max characters kept per string before truncation. Default 65536 (64 KB).
   * Pass `Infinity` to disable truncation (see CLIENT_EVENT_SHRED_OPTIONS).
   */
  maxStringLength?: number;
  /** Max nesting depth before a node collapses to a placeholder. Default 12. */
  maxDepth?: number;
  /** Max array/object entries kept per node. Default 1000. */
  maxEntries?: number;
}

const DEFAULTS: Required<ShredOptions> = {
  maxStringLength: 65536,
  maxDepth: 12,
  maxEntries: 1000,
};

/**
 * Options for client-originated events (dashboard log worker, electron
 * enrollment logger). These carry crash reports / client stacks that routinely
 * exceed 64 KB and are only useful whole, so they skip string truncation.
 * Secret redaction, depth and entry caps still apply.
 */
export const CLIENT_EVENT_SHRED_OPTIONS: Readonly<ShredOptions> = Object.freeze({
  maxStringLength: Number.POSITIVE_INFINITY,
});

const REDACTED = "[REDACTED]";

// A user-controlled `__proto__`/`constructor`/`prototype` key must never be
// written onto an object (prototype pollution / property injection). They carry
// no log value, so we drop them via an explicit literal guard at each write site.

// KEY detector. A field name is split into words (camelCase, PascalCase,
// ACRONYMCase, snake_case, kebab-case, dotted) and matched WORD BY WORD, not as
// a substring — so `tokensIn`, `tokenEmail`, `cookieNames` are not mistaken for
// secrets while `accessToken`, `x-api-key`, `REFRESH_TOKEN`, `clientSecret` are.

// A single word that on its own names a secret.
const SECRET_WORDS = new Set([
  "password", "passwords", "passwd", "pwd",
  "token", "apikey", "secret", "secrets",
  "authorization", "credential", "credentials",
  "cookie", "cookies", "privatekey", "jwt", "passphrase",
]);

// Two adjacent words that together name a secret (`api_key`, `privateKey`, `pass_phrase`).
const SECRET_WORD_PAIRS = new Set(["api key", "private key", "pass phrase"]);

// A glued all-lowercase word that ENDS in one of these is still a secret
// (`accesstoken`, `xapikey`, `setcookie`, `clientsecret`) — HTTP headers and
// some SDKs emit keys without separators.
const GLUED_SECRET_SUFFIX_RE =
  /(password|passwd|token|apikey|secret|authorization|credentials?|cookie|privatekey|jwt|passphrase)$/;

// Last word (or last two words glued) that makes the field a safe sibling of a
// secret stem: masked preview, presence flag, source, expiry, count, the owner's
// identity from a decoded token, etc. Checked first and wins.
const SAFE_LAST_WORDS = new Set([
  "preview", "present", "source", "exp", "expiry", "expiresat", "expires",
  "tokens", "count", "length", "type", "name", "names", "id", "ids",
  "in", "out", "tried", "email", "sub", "suffix",
]);

// A boolean flag named `has*` / `is*` (`hasBroadcastToken`, `has_private_key`,
// `isTokenValid`) can never carry a secret, whatever the rest of the name says.
const BOOLEAN_FLAG_PREFIXES = new Set(["has", "is"]);

/** Split a field name into lowercase words. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Secret-shaped value patterns, redacted wherever they appear in any string. */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // PEM private-key blocks (any label: RSA/EC/OPENSSH/…). Must run first.
  [/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, "[REDACTED_PEM]"],
  // Anything after `Authorization: Bearer` is a credential, whatever its shape.
  [/\b(authorization["']?\s*[:=]\s*["']?[Bb]earer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[REDACTED]"],
  // `Bearer <token>` in an Authorization header or free text. The token must
  // contain a digit or be 20+ chars, so prose like "bearer returned 401" survives.
  [/\b[Bb]earer\s+(?=[A-Za-z0-9._~+/=-]*[0-9]|[A-Za-z0-9._~+/=-]{20,})[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]"],
  // JSON Web Tokens: three base64url segments starting `eyJ…`.
  [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}/g, "[REDACTED_JWT]"],
  // OpenAI / Anthropic style prefixed keys: sk-, sk-ant-, rk-, pk_live_, …
  [/\b(?:sk|rk|pk|ak)[-_](?:[A-Za-z0-9]{2,}[-_])?[A-Za-z0-9]{16,}\b/g, "[REDACTED_KEY]"],
  // AWS access-key id.
  [/\bAKIA[0-9A-Z]{16}\b/g, "[REDACTED_AWS_KEY]"],
  // GitHub tokens (ghp_, gho_, ghs_, ghr_, github_pat_).
  [/\bgh[opsru]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_KEY]"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "[REDACTED_KEY]"],
  // Slack tokens (xoxb-, xoxp-, xapp-, …).
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_KEY]"],
  // Inline `secret=value` / `password: value` regardless of surrounding key.
  // (Not `authorization` — real header values are caught by the Bearer rule,
  // and matching it here over-redacts innocent `authorization: <enum>` prose.)
  [/\b(password|passwd|pwd|token|secret|api[_-]?key)\b(\s*[:=]\s*)("?)([^\s,;"']{4,})\3/gi, "$1$2[REDACTED]"],
];

// Neutralise newlines/tabs (→ space) so a user value can't forge extra log
// lines on a plain-text sink (log injection), and drop other C0/DEL control
// chars entirely. On JSON sinks this is belt-and-suspenders; on console/stdout
// sinks it's the actual guard.
function scrubControlChars(s: string): string {
  // eslint-disable-next-line no-control-regex
  return s.replace(/[\t\n\r\v\f]/g, " ").replace(/[\x00-\x08\x0E-\x1F\x7F]/g, "");
}

function applyValuePatterns(s: string, max: number): string {
  let out = s;
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  if (out.length > max) out = out.slice(0, max) + `…[truncated ${out.length - max} chars]`;
  return out;
}

function redactString(s: string, max: number): string {
  return applyValuePatterns(scrubControlChars(s), max);
}

// Same as redactString but keeps "\n", for multi-line text printed by a trusted sink (stacks).
function redactKeepingLines(s: string, max: number): string {
  return applyValuePatterns(s.split("\n").map(scrubControlChars).join("\n"), max);
}

/** Whether a field name denotes a secret (and is not a safe sibling). */
export function isSecretKey(key: string): boolean {
  const words = keyWords(key);
  const last = words[words.length - 1];
  if (last === undefined) return false;
  const prev = words[words.length - 2];
  if (SAFE_LAST_WORDS.has(last) || (prev !== undefined && SAFE_LAST_WORDS.has(prev + last))) return false;
  for (let i = 0; i < words.length; i++) {
    const w = words[i] as string;
    if (SECRET_WORDS.has(w)) return true;
    const next = words[i + 1];
    if (next !== undefined && SECRET_WORD_PAIRS.has(`${w} ${next}`)) return true;
  }
  // Separator-less keys (`accesstoken`, `x-apikey`): only the final word may be glued.
  return last.length > 3 && GLUED_SECRET_SUFFIX_RE.test(last);
}

/** Key detector applied to an actual field: boolean `has*`/`is*` flags are always kept. */
function isSecretField(key: string, value: unknown): boolean {
  if (typeof value === "boolean" && BOOLEAN_FLAG_PREFIXES.has(keyWords(key)[0] ?? "")) return false;
  return isSecretKey(key);
}

function serializeError(err: Error, max: number): Record<string, LogValueOut> {
  const out: Record<string, LogValueOut> = {
    name: err.name,
    message: redactString(err.message, max),
  };
  if (typeof err.stack === "string") out.stack = redactString(err.stack, max);
  // Copy common structured fields (HTTP/Node errors) but shred their values.
  for (const field of ["code", "status", "statusCode", "errno", "syscall"] as const) {
    const v = (err as unknown as Record<string, unknown>)[field];
    if (typeof v === "string" || typeof v === "number") out[field] = v;
  }
  return out;
}

type LogValueOut = string | number | boolean | null | LogValueOut[] | { [k: string]: LogValueOut };

/** Dotted path of `key` under `parent` (array indices are not part of the path). */
function childPath(parent: string, key: string): string {
  return parent === "" ? key : `${parent}.${key}`;
}

/** KEY detector, minus fields allow-listed for this record's module. */
function redactByKey(key: string, value: unknown, path: string, allow: ReadonlySet<string> | undefined): boolean {
  return isSecretField(key, value) && !(allow !== undefined && allow.has(path));
}

function shredNode(
  value: unknown,
  seen: WeakSet<object>,
  depth: number,
  opts: Required<ShredOptions>,
  path: string,
  allow: ReadonlySet<string> | undefined,
): LogValueOut {
  // Primitives.
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === "string") return redactString(value as string, opts.maxStringLength);
  if (t === "number") return Number.isFinite(value as number) ? (value as number) : String(value);
  if (t === "boolean") return value as boolean;
  if (t === "bigint") return (value as bigint).toString();
  if (t === "function" || t === "symbol") return `[${t}]`;

  // Non-plain objects that must not be walked key-by-key.
  if (value instanceof Error) return serializeError(value, opts.maxStringLength);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[Invalid Date]" : value.toISOString();
  if (typeof Buffer !== "undefined" && Buffer.isBuffer(value)) return `[Buffer ${value.length}b]`;
  if (ArrayBuffer.isView(value)) return `[${(value as { constructor: { name: string } }).constructor.name}]`;

  // From here on it is an object/array/map/set.
  const obj = value as object;
  if (seen.has(obj)) return "[Circular]";
  if (depth >= opts.maxDepth) return Array.isArray(value) ? "[Array]" : "[Object]";
  seen.add(obj);
  try {
    if (value instanceof Map) return shredNode(Object.fromEntries(value), seen, depth, opts, path, allow);
    if (value instanceof Set) return shredNode([...value], seen, depth, opts, path, allow);

    if (Array.isArray(value)) {
      const arr: LogValueOut[] = [];
      const n = Math.min(value.length, opts.maxEntries);
      for (let i = 0; i < n; i++) arr.push(shredNode(value[i], seen, depth + 1, opts, path, allow));
      if (value.length > n) arr.push(`…[${value.length - n} more]`);
      return arr;
    }

    // Collect [key, value] pairs and build the object with Object.fromEntries
    // rather than `out[key] = …`. Field names still come from the input (that's
    // the point — preserve the log contract), but we never use a user value as a
    // property-write target, and __proto__/constructor/prototype are dropped, so
    // there is no prototype-pollution / property-injection surface.
    const entries: Array<[string, LogValueOut]> = [];
    const keys = Object.keys(value as Record<string, unknown>);
    let count = 0;
    for (const key of keys) {
      if (count >= opts.maxEntries) {
        entries.push(["…", `[${keys.length - count} more keys]`]);
        break;
      }
      count++;
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      // KEY detector: secret-named field redacted wholesale (don't recurse into it),
      // unless this exact path is allow-listed for the record's module.
      const v = (value as Record<string, unknown>)[key];
      const p = childPath(path, key);
      entries.push([key, redactByKey(key, v, p, allow) ? REDACTED : shredNode(v, seen, depth + 1, opts, p, allow)]);
    }
    return Object.fromEntries(entries);
  } finally {
    seen.delete(obj);
  }
}

function shredAt(value: unknown, o: Required<ShredOptions>, path: string, allow: ReadonlySet<string> | undefined): LogValueOut {
  try {
    return shredNode(value, new WeakSet(), 0, o, path, allow);
  } catch {
    return "[unserializable]";
  }
}

/**
 * Deep-redact a value into a JSON-safe clone. Never throws. When the value is
 * a record with a string `module`, that module's allow-list entries apply.
 */
export function shred(value: unknown, opts?: ShredOptions): LogValueOut {
  const o = { ...DEFAULTS, ...opts };
  let allow: ReadonlySet<string> | undefined;
  try {
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      allow = allowedPathsFor((value as Record<string, unknown>).module);
    }
  } catch {
    allow = undefined;
  }
  return shredAt(value, o, "", allow);
}

/**
 * Redacted copy of an Error that stays an Error with a multi-line stack, for
 * sinks that print Errors natively. Own enumerable fields are shredded too.
 */
export function shredError(err: Error, opts?: ShredOptions): Error {
  const o = { ...DEFAULTS, ...opts };
  try {
    const copy = new Error(redactKeepingLines(err.message, o.maxStringLength));
    copy.name = err.name;
    if (typeof err.stack === "string") copy.stack = redactKeepingLines(err.stack, o.maxStringLength);
    else delete copy.stack;
    const extra = shred({ ...err }, opts);
    if (extra !== null && typeof extra === "object" && !Array.isArray(extra)) Object.assign(copy, extra);
    return copy;
  } catch {
    return new Error("[unserializable]");
  }
}

/** Redact secrets from a plain string (a message/log line). Returns a string. Never throws. */
export function shredText(text: string, opts?: ShredOptions): string {
  try {
    return redactString(text, { ...DEFAULTS, ...opts }.maxStringLength);
  } catch {
    return "[unserializable]";
  }
}

// Redact a record IN PLACE over its string keys; skips `level` (winston-owned, may
// carry colour codes) and leaves symbol keys (winston's Symbol(level)/Symbol(splat))
// untouched. `message` and string `timestamp` get value patterns only, so a real
// time is unchanged. Mutates (not clones) for winston formats.
export function shredRecordInPlace<T extends Record<string, unknown>>(
  record: T,
  opts?: ShredOptions,
): T {
  const o = { ...DEFAULTS, ...opts };
  // Mutable alias: we write back to string keys in place (a generic T can only
  // be indexed for reading). Symbol keys are untouched since we iterate Object.keys.
  const rec = record as Record<string, unknown>;
  try {
    const allow = allowedPathsFor(rec.module);
    for (const key of Object.keys(rec)) {
      if (key === "level") continue;
      // Property-injection / prototype-pollution guard.
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const value = rec[key];
      if (key === "message") {
        rec[key] = typeof value === "string" ? redactString(value, o.maxStringLength) : shredAt(value, o, key, allow);
        continue;
      }
      if (key === "timestamp") {
        if (typeof value === "string") rec[key] = redactString(value, o.maxStringLength);
        continue;
      }
      rec[key] = redactByKey(key, value, key, allow) ? REDACTED : shredAt(value, o, key, allow);
    }
  } catch {
    /* never throw from the logging path */
  }
  return record;
}
