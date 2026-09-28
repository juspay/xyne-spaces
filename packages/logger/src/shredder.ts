// The shredder — one denylist redaction pass for every log record (PRD R3/R4).
// Redacts secret VALUES only (field names kept => frozen Grafana contract intact)
// via two detectors: by KEY (secret-named field) and by VALUE (secret-shaped
// string). Cycle-safe, size-capped, control-char scrubbed, and never throws.

export interface ShredOptions {
  /** Max characters kept per string before truncation. Default 8192. */
  maxStringLength?: number;
  /** Max nesting depth before a node collapses to a placeholder. Default 12. */
  maxDepth?: number;
  /** Max array/object entries kept per node. Default 1000. */
  maxEntries?: number;
}

const DEFAULTS: Required<ShredOptions> = {
  maxStringLength: 8192,
  maxDepth: 12,
  maxEntries: 1000,
};

const REDACTED = "[REDACTED]";

// A user-controlled `__proto__`/`constructor`/`prototype` key must never be
// written onto an object (prototype pollution / property injection). They carry
// no log value, so we drop them via an explicit literal guard at each write site.

// Secret stems, matched as substrings on the normalized key (so accessToken,
// x-api-key, refresh_token, clientSecret all hit).
const SECRET_KEY_RE =
  /(password|passwd|pwd|token|apikey|secret|authorization|credential|cookie|privatekey|jwt|passphrase)/;

// Safe siblings of a secret stem (masked preview, presence flag, source, expiry,
// token count…). Checked first and wins over SECRET_KEY_RE.
const SAFE_KEY_RE = /(preview|present|source|exp|expiry|expiresat|tokens|count|length|type|name|id)$/;

/** Secret-shaped value patterns, redacted wherever they appear in any string. */
const VALUE_PATTERNS: Array<[RegExp, string]> = [
  // PEM private-key blocks (any label: RSA/EC/OPENSSH/…). Must run first.
  [/-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/g, "[REDACTED_PEM]"],
  // `Bearer <token>` in an Authorization header or free text.
  [/\b[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}/g, "Bearer [REDACTED]"],
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

function redactString(s: string, max: number): string {
  let out = scrubControlChars(s);
  for (const [re, rep] of VALUE_PATTERNS) out = out.replace(re, rep);
  if (out.length > max) out = out.slice(0, max) + `…[truncated ${out.length - max} chars]`;
  return out;
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[_-]/g, "");
}

/** Whether a field name denotes a secret (and is not a safe sibling). */
export function isSecretKey(key: string): boolean {
  const n = normalizeKey(key);
  if (SAFE_KEY_RE.test(n)) return false;
  return SECRET_KEY_RE.test(n);
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

function shredNode(value: unknown, seen: WeakSet<object>, depth: number, opts: Required<ShredOptions>): LogValueOut {
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
    if (value instanceof Map) return shredNode(Object.fromEntries(value), seen, depth, opts);
    if (value instanceof Set) return shredNode([...value], seen, depth, opts);

    if (Array.isArray(value)) {
      const arr: LogValueOut[] = [];
      const n = Math.min(value.length, opts.maxEntries);
      for (let i = 0; i < n; i++) arr.push(shredNode(value[i], seen, depth + 1, opts));
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
      // KEY detector: secret-named field redacted wholesale (don't recurse into it).
      entries.push([key, isSecretKey(key) ? REDACTED : shredNode((value as Record<string, unknown>)[key], seen, depth + 1, opts)]);
    }
    return Object.fromEntries(entries);
  } finally {
    seen.delete(obj);
  }
}

/** Deep-redact a value into a JSON-safe clone. Never throws. */
export function shred(value: unknown, opts?: ShredOptions): LogValueOut {
  const o = { ...DEFAULTS, ...opts };
  try {
    return shredNode(value, new WeakSet(), 0, o);
  } catch {
    return "[unserializable]";
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

// Redact a record IN PLACE over its string keys; skips `level`/`timestamp` and
// leaves symbol keys (winston's Symbol(level)/Symbol(splat)) untouched. `message`
// keeps its key, value-pattern redacted. Mutates (not clones) for winston formats.
export function shredRecordInPlace<T extends Record<string, unknown>>(
  record: T,
  opts?: ShredOptions,
): T {
  const o = { ...DEFAULTS, ...opts };
  // Mutable alias: we write back to string keys in place (a generic T can only
  // be indexed for reading). Symbol keys are untouched since we iterate Object.keys.
  const rec = record as Record<string, unknown>;
  try {
    for (const key of Object.keys(rec)) {
      if (key === "level" || key === "timestamp") continue;
      // Property-injection / prototype-pollution guard.
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      const value = rec[key];
      if (key === "message") {
        rec[key] = typeof value === "string" ? redactString(value, o.maxStringLength) : shred(value, o);
        continue;
      }
      rec[key] = isSecretKey(key) ? REDACTED : shred(value, o);
    }
  } catch {
    /* never throw from the logging path */
  }
  return record;
}
