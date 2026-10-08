const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f-\u009f]/g;

export function logSafe(value: unknown): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.replace(CONTROL_CHARS_RE, " ");
}
