/**
 * Tool-call result formatting for the debugger / activity views.
 *
 * The claw agent producer coerces every tool result to a string with a plain
 * `JSON.stringify(result)` (NO indentation) — see xyne-claw `agent.ts`
 * `coerceResult`. Structured results therefore arrive as one unreadable line.
 * Results also commonly come back as MCP "content block" arrays
 * (`[{ type: "text", text: "…" }]`). These helpers turn either shape into
 * something a human can actually read, without changing what's stored/streamed.
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parse a string as JSON when it *looks* like JSON; otherwise return it as-is. */
export function tryParseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !["{", "["].includes(trimmed[0] ?? "")) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * Collapse an MCP content-block array (`[{ type: "text", text }]`) to its joined
 * text. Returns `null` when `value` isn't a pure text-block array, so callers
 * fall through to generic tree/JSON rendering for richer shapes (images, etc.).
 */
export function unwrapContentBlocks(value: unknown): string | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const texts: string[] = [];
  for (const block of value) {
    if (!isRecord(block) || block.type !== "text" || typeof block.text !== "string") return null;
    texts.push(block.text);
  }
  return texts.join("\n");
}

/**
 * Recursively parse JSON-in-string so a tree viewer can expand nested payloads
 * instead of showing one escaped blob, and collapse text content blocks to
 * their string. Depth-bounded to avoid pathological nesting.
 */
export function deepParseJson(value: unknown, depth = 0): unknown {
  if (depth > 6) return value;
  const parsed = tryParseJson(value);
  const unwrapped = unwrapContentBlocks(parsed);
  if (unwrapped !== null) return deepParseJson(unwrapped, depth + 1);
  if (Array.isArray(parsed)) return parsed.map((item) => deepParseJson(item, depth + 1));
  if (isRecord(parsed)) {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(parsed)) out[key] = deepParseJson(val, depth + 1);
    return out;
  }
  return parsed;
}

/**
 * Produce a readable string for a raw tool-result string, for `<pre>` display:
 *  - content-block arrays → joined text (pretty-printed if the text is itself JSON)
 *  - JSON objects/arrays   → pretty-printed (2-space indent)
 *  - plain text            → returned unchanged (real newlines preserved)
 */
export function formatToolResult(result: string): string {
  if (!result) return result;
  const parsed = tryParseJson(result);
  const unwrapped = unwrapContentBlocks(parsed);
  if (unwrapped !== null) {
    const inner = tryParseJson(unwrapped);
    return isRecord(inner) || Array.isArray(inner) ? JSON.stringify(inner, null, 2) : unwrapped;
  }
  if (isRecord(parsed) || Array.isArray(parsed)) {
    try {
      return JSON.stringify(parsed, null, 2);
    } catch {
      return result;
    }
  }
  return result;
}
