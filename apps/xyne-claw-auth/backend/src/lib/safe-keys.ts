const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export function isSafeObjectKey(key: unknown): key is string {
  return typeof key === "string" && key.length > 0 && !FORBIDDEN_KEYS.has(key);
}
