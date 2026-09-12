const SEGMENT_RE = /^[A-Za-z0-9._~-]+$/;

export function pathSegment(label: string, value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!raw || !SEGMENT_RE.test(raw) || raw === "." || raw === "..") {
    throw new Error(`${label}: invalid value — expected a single path segment matching [A-Za-z0-9._~-]+`);
  }
  return encodeURIComponent(raw);
}

export function safePathSegment(value: unknown): string | null {
  const raw = typeof value === "string" ? value.trim() : typeof value === "number" ? String(value) : "";
  if (!raw || !SEGMENT_RE.test(raw) || raw === "." || raw === "..") return null;
  return encodeURIComponent(raw);
}

export function repoFilePath(label: string, value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw) throw new Error(`${label}: a relative repository path is required`);
  if (/^[\\/]/.test(raw)) throw new Error(`${label}: path must be relative`);
  return raw
    .split("/")
    .map((segment) => pathSegment(label, segment))
    .join("/");
}

export function countTrailingBase64Padding(value: string): number {
  let n = 0;
  while (n < value.length && value.charCodeAt(value.length - 1 - n) === 61) n += 1;
  return n;
}
