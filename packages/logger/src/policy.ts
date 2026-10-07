// Redaction allow-list — config-driven exceptions to the KEY detector.
//
// Set once per service via the LOG_REDACT_ALLOW_PATHS env var (Helm `env:`),
// so no exception is hardcoded in this package. Format: comma-separated
// `<module>:<dotted.path>` entries, e.g.
//
//   LOG_REDACT_ALLOW_PATHS="MobilePush:tokenPreview,UserSessionLogging:changes.fcmTokenPreview"
//
// - `<module>` must equal the log record's `module` field exactly.
// - `<dotted.path>` is the field path from the record root; array indices are
//   skipped (`changes.fcmToken` matches every element of a `changes` array).
// - Wildcards are rejected, as are entries without a module or a path.
// - An allowed field only bypasses the KEY detector. Its string value still goes
//   through every VALUE pattern (Bearer, JWT, xox*-, sk-, AKIA, PEM, …).
// - Unset / empty / all-invalid => empty list => strict redaction (fail safe).
//
// The value is read once (first use) and cached for the life of the process.
// Browser bundles have no `process.env`, so they always get the strict default.

export const REDACT_ALLOW_ENV = "LOG_REDACT_ALLOW_PATHS";

export interface RedactAllowList {
  /** module -> allowed dotted paths for that module. */
  readonly byModule: ReadonlyMap<string, ReadonlySet<string>>;
  /** Accepted entries, normalised `<module>:<path>`, sorted. */
  readonly accepted: readonly string[];
  /** Entries that were ignored (malformed or wildcard). */
  readonly rejected: readonly string[];
}

const ENTRY_RE = /^([A-Za-z0-9_.\-/[\]]+):([A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*)$/;

export function parseRedactAllowList(raw: string | undefined | null): RedactAllowList {
  const byModule = new Map<string, Set<string>>();
  const accepted: string[] = [];
  const rejected: string[] = [];
  if (typeof raw === "string" && raw.trim() !== "") {
    for (const part of raw.split(",")) {
      const entry = part.trim();
      if (entry === "") continue;
      const m = entry.includes("*") ? null : ENTRY_RE.exec(entry);
      if (!m) {
        rejected.push(entry);
        continue;
      }
      const mod = m[1] as string;
      const path = m[2] as string;
      let set = byModule.get(mod);
      if (!set) {
        set = new Set<string>();
        byModule.set(mod, set);
      }
      if (!set.has(path)) {
        set.add(path);
        accepted.push(`${mod}:${path}`);
      }
    }
  }
  accepted.sort();
  return { byModule, accepted, rejected };
}

function readEnv(): string | undefined {
  try {
    const p = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
    return p?.env?.[REDACT_ALLOW_ENV];
  } catch {
    return undefined;
  }
}

let cached: RedactAllowList | undefined;

/** The active allow-list (env read once, then cached). */
export function getRedactAllowList(): RedactAllowList {
  if (!cached) cached = parseRedactAllowList(readEnv());
  return cached;
}

/**
 * Override the active allow-list (tests, or hosts without `process.env`).
 * Pass `undefined` to re-read the env var on next use.
 */
export function setRedactAllowList(raw: string | undefined): void {
  cached = raw === undefined ? undefined : parseRedactAllowList(raw);
}

/** Allowed paths for a record's `module`, or undefined when none apply. */
export function allowedPathsFor(module: unknown): ReadonlySet<string> | undefined {
  if (typeof module !== "string" || module === "") return undefined;
  const list = getRedactAllowList();
  if (list.byModule.size === 0) return undefined;
  return list.byModule.get(module);
}

/**
 * Metadata for the one-line startup log every service emits, so SRE can
 * confirm what the deployed value resolved to. Returns null when the env var
 * is unset/empty (nothing to report).
 */
export function describeRedactAllowList(): { accepted: string[]; rejected: string[] } | null {
  const raw = readEnv();
  if (typeof raw !== "string" || raw.trim() === "") return null;
  const list = getRedactAllowList();
  return { accepted: [...list.accepted], rejected: [...list.rejected] };
}
