/**
 * Declared-schema validation for agent-automations webhook payloads.
 *
 * Ported verbatim (minus the zod wrapper) from xyne-spaces'
 * `backend/src/automations/engine/declared-schema.ts`. Dependency-free so the
 * public ingress can cheaply reject a malformed body BEFORE any DB write or
 * agent-run dispatch.
 *
 * A declared schema is a recursive record whose leaves are field-type strings.
 * Declared keys are REQUIRED; extra keys in the payload are allowed (webhook
 * senders add fields over time). `secret` is a string leaf that also marks a
 * header value sensitive so it is redacted before storage.
 */

export const FIELD_TYPES = ["string", "number", "boolean", "object", "array", "secret"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** A node is either a leaf type or a nested record of nodes. */
export type SchemaNode = FieldType | DeclaredSchema;
export interface DeclaredSchema {
  [key: string]: SchemaNode;
}

export function isFieldType(v: unknown): v is FieldType {
  return typeof v === "string" && (FIELD_TYPES as readonly string[]).includes(v);
}

/**
 * Throws with a human-readable path (`issue.number`) on the first mismatch.
 * Callers map a throw to HTTP 400.
 */
export function assertMatchesSchema(
  actual: Record<string, unknown>,
  declared: Record<string, unknown>,
  path = "",
): void {
  for (const [key, expected] of Object.entries(declared)) {
    const here = path ? `${path}.${key}` : key;
    if (!(key in actual)) throw new Error(`required key "${here}" missing`);
    const v = actual[key];
    const actualType = Array.isArray(v) ? "array" : v === null ? "null" : typeof v;
    if (typeof expected === "string") {
      const wanted = expected === "secret" ? "string" : expected;
      if (actualType !== wanted) {
        throw new Error(`key "${here}" expected ${wanted}, got ${actualType}`);
      }
    } else if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (actualType !== "object") {
        throw new Error(`key "${here}" expected object, got ${actualType}`);
      }
      assertMatchesSchema(v as Record<string, unknown>, expected as Record<string, unknown>, here);
    }
  }
}

/** Non-throwing wrapper — returns `{ ok }` or `{ ok:false, error }`. */
export function matchesSchema(
  actual: Record<string, unknown>,
  declared: Record<string, unknown>,
): { ok: true } | { ok: false; error: string } {
  try {
    assertMatchesSchema(actual, declared);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
