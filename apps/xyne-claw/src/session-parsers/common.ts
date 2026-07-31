/**
 * Shared helpers for all session parsers.
 */

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function safeJson(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return "";
  }
}

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

export function extractTopLevelString(obj: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const v = obj[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return "";
}

export function joinNonEmpty(parts: (string | undefined | null)[], sep = "\n"): string {
  return parts.filter((p): p is string => typeof p === "string" && p.trim().length > 0).join(sep);
}
