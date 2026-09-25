/**
 * Redaction helpers for OrcaRouter.
 *
 * An `sk-orca-…` key and a PKCE verifier are secrets: they must never reach a
 * log line, an error message, telemetry, a URL, or an HTTP response. These
 * helpers are the single place that knows how to remove them, so every log
 * site uses the same rule.
 */

/** Masked form shown to the user: prefix + last four, everything else elided. */
export const MASKED_KEY = "sk-orca-…";

export function maskOrcaRouterKey(value: unknown): string {
  if (typeof value !== "string") return MASKED_KEY;
  const trimmed = value.trim();
  if (!trimmed) return MASKED_KEY;
  const tail = trimmed.length > 4 ? trimmed.slice(-4) : "";
  return tail ? `sk-orca-…${tail}` : MASKED_KEY;
}

/** Anything shaped like an OrcaRouter key, in any position of a string. */
const KEY_PATTERN = /sk-orca-[A-Za-z0-9._~+/-]{0,}/gi;
/** A PKCE verifier / challenge: base64url, long enough not to be prose. */
const TOKEN_PATTERN = /(?<![A-Za-z0-9._~-])[A-Za-z0-9_-]{43,}(?![A-Za-z0-9._~-])/g;
/** `code_verifier=…`, `"code_verifier": "…"`, `code=…` in a querystring. */
const VERIFIER_ASSIGNMENT_PATTERN = /(code_verifier|code_challenge|device_code|code)(["']?\s*[:=]\s*["']?)([^\s"'&,}]+)/gi;

/**
 * Strip any key or verifier from a string before it is logged. Returns the
 * string unchanged when there is nothing to remove.
 */
export function redactOrcaRouterSecrets(value: string): string {
  if (!value) return "";
  return value
    .replace(KEY_PATTERN, "[redacted-key]")
    .replace(VERIFIER_ASSIGNMENT_PATTERN, (_match, name: string, sep: string) => `${name}${sep}[redacted]`)
    .replace(TOKEN_PATTERN, "[redacted]");
}

/** Redact every string reachable from a structured log payload. */
export function redactOrcaRouterLogValue<T>(value: T, depth = 0): T {
  if (depth > 4) return "[redacted]" as unknown as T;
  if (typeof value === "string") return redactOrcaRouterSecrets(value) as unknown as T;
  if (Array.isArray(value)) return value.map((entry) => redactOrcaRouterLogValue(entry, depth + 1)) as unknown as T;
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = /verifier|api_?key|secret|token|code/i.test(key) && typeof entry === "string"
        ? "[redacted]"
        : redactOrcaRouterLogValue(entry, depth + 1);
    }
    return out as unknown as T;
  }
  return value;
}

/** Which secrets a test should assert are absent. */
export const ORCAROUTER_SECRET_SHAPES = {
  key: /sk-orca-[A-Za-z0-9]/,
  /** A base64url run of verifier length — catches the verifier without needing it. */
  token: /(?<![A-Za-z0-9._~-])[A-Za-z0-9_-]{43,}(?![A-Za-z0-9._~-])/,
} as const;

export interface SecretLeakCheck {
  containsNoSecret: boolean;
  /** Which of the expected secrets was found (empty when clean). */
  leaked: string[];
}

/**
 * Test helper: assert a string carries no secret. Pass every secret the test
 * holds (the fake key, the verifier, the state) — a string that contains none
 * of them is safe to log, return, or snapshot.
 */
export function assertNoOrcaRouterSecret(text: string, secrets: readonly string[]): SecretLeakCheck {
  const leaked: string[] = [];
  for (const secret of secrets) {
    if (secret && text.includes(secret)) leaked.push(secret);
  }
  if (ORCAROUTER_SECRET_SHAPES.key.test(text)) leaked.push("<sk-orca-shaped key>");
  return { containsNoSecret: leaked.length === 0, leaked };
}
