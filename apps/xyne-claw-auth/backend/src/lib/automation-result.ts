/**
 * Coerce a finished agent answer into the shape Spaces RUN_AGENT expects.
 *
 * When a Claw agent emits structured JSON output, `text` is already a JSON
 * object string (e.g. `{"title":"...","description":"..."}`). Wrapping it
 * again as `{"result":"<text>"}` double-encodes the payload and breaks the
 * automation schema check.
 *
 * Plain-text/markdown answers are not JSON objects, so we preserve the old
 * behaviour of wrapping them as `{"result":"<text>"}`. Downstream steps can
 * still access the text as `output.result`.
 */
export function coerceAutomationForwardResult(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
        return trimmed;
      }
    } catch {
      // Not valid JSON — fall through to the plain-text wrapper.
    }
  }
  return JSON.stringify({ result: text });
}
