// Redaction config from Superposition: per-field exceptions (`allowPaths`, `<module>:<dotted.path>`)
// and the KEY detector's word lists. A list in the config replaces its fallback below.
// `"enabled": false` is a kill switch: only main's legacy patterns run (see shredder.ts).

export const REDACT_CONFIG_KEY = "log_redaction";

// Used until a config arrives (startup, services without Superposition, old desktop builds).
export const FALLBACK_KEY_WORDS = Object.freeze({
  secretWords: [
    "password", "passwords", "passwd", "pwd", "token", "apikey", "secret", "secrets",
    "authorization", "credential", "credentials", "cookie", "cookies", "privatekey", "jwt", "passphrase",
  ],
  secretWordPairs: ["api key", "private key", "pass phrase"],
  gluedSecretSuffixes: [
    "password", "passwd", "token", "apikey", "secret", "authorization",
    "credential", "credentials", "cookie", "privatekey", "jwt", "passphrase",
  ],
  safeLastWords: [
    "preview", "present", "source", "exp", "expiry", "expiresat", "expires", "tokens", "count", "length",
    "type", "name", "names", "id", "ids", "in", "out", "tried", "email", "sub", "suffix",
  ],
  booleanFlagPrefixes: ["has", "is"],
});
type KeyWordList = keyof typeof FALLBACK_KEY_WORDS;
const CONFIG_FIELDS: readonly string[] = ["allowPaths", ...Object.keys(FALLBACK_KEY_WORDS)];

export interface RedactConfig {
  readonly enabled: boolean;
  /** module -> allowed dotted paths. */
  readonly allowPaths: ReadonlyMap<string, ReadonlySet<string>>;
  readonly secretWords: ReadonlySet<string>;
  readonly secretWordPairs: ReadonlySet<string>;
  readonly gluedSecretSuffixRe: RegExp | undefined;
  readonly safeLastWords: ReadonlySet<string>;
  readonly booleanFlagPrefixes: ReadonlySet<string>;
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
  /** Accepted config in Superposition format, for relaying downstream; null when empty. */
  readonly value: Readonly<Record<string, unknown>> | null;
}

const ALLOW_PATH_RE = /^([A-Za-z0-9_.\-/[\]]+):([A-Za-z0-9_\-]+(?:\.[A-Za-z0-9_\-]+)*)$/;
const WORD_RE = /^[a-z0-9]+$/;
const PAIR_RE = /^[a-z0-9]+ [a-z0-9]+$/;

function toObject(raw: unknown): Record<string, unknown> | undefined {
  let v = raw;
  if (typeof v === "string") {
    try {
      v = JSON.parse(v);
    } catch {
      return undefined;
    }
  }
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

export function parseRedactConfig(raw: unknown): RedactConfig {
  const obj = toObject(raw);
  const { enabled = true, ...lists } = obj ?? {};
  const value: Record<string, string[]> = {};
  const rejected = obj || raw === undefined || raw === null || raw === "" ? [] : [String(raw).slice(0, 200)];
  // Anything but a boolean is rejected and keeps redaction on.
  if (typeof enabled !== "boolean") rejected.push(`enabled:${JSON.stringify(enabled)}`);
  // Iterate our own field names, never the config's keys (no `__proto__`/`constructor` writes).
  for (const field of Object.keys(lists)) if (!CONFIG_FIELDS.includes(field)) rejected.push(field);
  for (const field of CONFIG_FIELDS) {
    if (!Object.hasOwn(lists, field)) continue;
    const entries = lists[field];
    const re = field === "allowPaths" ? ALLOW_PATH_RE : field === "secretWordPairs" ? PAIR_RE : WORD_RE;
    if (!Array.isArray(entries)) {
      rejected.push(field);
      continue;
    }
    const ok: string[] = [];
    for (const entry of entries) {
      const s = typeof entry === "string" ? entry.trim() : "";
      if (!re.test(s)) rejected.push(`${field}:${String(entry)}`);
      else if (!ok.includes(s)) ok.push(s);
    }
    // [] empties a list; a list whose entries were all invalid keeps the fallback.
    if (ok.length > 0 || entries.length === 0) value[field] = ok;
  }

  const list = (name: KeyWordList): readonly string[] => value[name] ?? FALLBACK_KEY_WORDS[name];
  const allowPaths = new Map<string, Set<string>>();
  for (const entry of value.allowPaths ?? []) {
    const [, mod = "", path = ""] = ALLOW_PATH_RE.exec(entry) ?? [];
    allowPaths.set(mod, (allowPaths.get(mod) ?? new Set<string>()).add(path));
  }
  const suffixes = list("gluedSecretSuffixes");
  const disabled = enabled === false;
  return {
    enabled: !disabled,
    allowPaths,
    secretWords: new Set(list("secretWords")),
    secretWordPairs: new Set(list("secretWordPairs")),
    gluedSecretSuffixRe: suffixes.length > 0 ? new RegExp(`(?:${suffixes.join("|")})$`) : undefined,
    safeLastWords: new Set(list("safeLastWords")),
    booleanFlagPrefixes: new Set(list("booleanFlagPrefixes")),
    accepted: [...(disabled ? ["enabled:false"] : []), ...Object.entries(value).flatMap(([field, es]) => es.map((e) => `${field}:${e}`))].sort(),
    rejected,
    value: disabled ? { enabled: false, ...value } : Object.keys(value).length > 0 ? value : null,
  };
}

let active = parseRedactConfig(undefined);

export function getRedactConfig(): RedactConfig {
  return active;
}

export function setRedactConfig(raw: unknown): RedactConfig {
  active = parseRedactConfig(raw);
  return active;
}

export function allowedPathsFor(module: unknown): ReadonlySet<string> | undefined {
  return typeof module === "string" ? active.allowPaths.get(module) : undefined;
}

/**
 * Poll `fetchRaw` and apply changes. `null` (key absent) means the fallback;
 * a throw or `undefined` (source unreachable) keeps the last config.
 */
export function syncRedactConfig(
  fetchRaw: () => Promise<unknown>,
  { intervalMs = 60_000, onChange }: { intervalMs?: number; onChange?: (config: RedactConfig) => void } = {},
): () => void {
  let applied = "";
  let stopped = false;
  const tick = async (): Promise<void> => {
    const raw = await fetchRaw().catch(() => undefined);
    if (stopped || raw === undefined) return;
    const next = raw === null ? "" : JSON.stringify(toObject(raw) ?? raw);
    if (next === applied) return;
    applied = next;
    const config = setRedactConfig(raw);
    try {
      onChange?.(config);
    } catch {
      // A failing reporter must not stop the sync.
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), intervalMs);
  (timer as { unref?: () => void }).unref?.();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
