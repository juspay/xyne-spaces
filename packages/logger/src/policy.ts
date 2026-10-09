// Redaction allow-list — config-driven exceptions to the KEY detector.
//
// The value lives in Superposition under REDACT_ALLOW_CONFIG_KEY, so no
// exception is hardcoded in this package. Each service keeps it current with
// syncRedactAllowList (or pushes it in with setRedactAllowList). Format:
// comma-separated `<module>:<dotted.path>` entries (or a JSON array of them), e.g.
//
//   MobilePush:tokenPreview,UserSessionLogging:changes.fcmTokenPreview
//
// - `<module>` must equal the log record's `module` field exactly.
// - `<dotted.path>` is the field path from the record root; array indices are
//   skipped (`changes.fcmToken` matches every element of a `changes` array).
// - Wildcards are rejected, as are entries without a module or a path.
// - An allowed field only bypasses the KEY detector. Its string value still goes
//   through every VALUE pattern (Bearer, JWT, xox*-, sk-, AKIA, PEM, …).
// - Until a value arrives, or when it is empty / all-invalid, redaction is strict.

export const REDACT_ALLOW_CONFIG_KEY = "log_redact_allow_paths";

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

function normalizeRaw(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (Array.isArray(raw)) return raw.filter((e): e is string => typeof e === "string").join(",");
  return "";
}

let active: RedactAllowList = parseRedactAllowList(undefined);

/** The active allow-list (strict until a value is set). */
export function getRedactAllowList(): RedactAllowList {
  return active;
}

/** Replace the active allow-list from a raw config value; anything unusable means strict. */
export function setRedactAllowList(raw: unknown): RedactAllowList {
  active = parseRedactAllowList(normalizeRaw(raw));
  return active;
}

/** Allowed paths for a record's `module`, or undefined when none apply. */
export function allowedPathsFor(module: unknown): ReadonlySet<string> | undefined {
  if (typeof module !== "string" || module === "") return undefined;
  if (active.byModule.size === 0) return undefined;
  return active.byModule.get(module);
}

export interface RedactAllowSyncOptions {
  /** Poll interval in ms. Default 60000. */
  intervalMs?: number;
  /** Called whenever the applied value changes, e.g. to log accepted/rejected. */
  onChange?: (list: RedactAllowList) => void;
}

/**
 * Poll `fetchRaw` and apply what it returns. `null` (key absent) means strict;
 * a throw or `undefined` (source unreachable) keeps the last applied list.
 * Returns a stop function.
 */
export function syncRedactAllowList(
  fetchRaw: () => Promise<unknown>,
  opts: RedactAllowSyncOptions = {},
): () => void {
  let applied = "";
  let stopped = false;
  const tick = async (): Promise<void> => {
    let raw: unknown;
    try {
      raw = await fetchRaw();
    } catch {
      return;
    }
    if (stopped || raw === undefined) return;
    const next = normalizeRaw(raw);
    if (next === applied) return;
    applied = next;
    const list = setRedactAllowList(next);
    try {
      opts.onChange?.(list);
    } catch {
      // A failing reporter must not stop the sync.
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 60_000);
  (timer as { unref?: () => void }).unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
