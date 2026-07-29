/**
 * Strip markdown code fences (```json ... ``` or ``` ... ```) and leading
 * prose from an LLM response so it can be parsed as JSON.
 *
 * LLMs frequently wrap JSON in fences or prefix it with text like
 * "Here is the response:" despite "STRICT JSON only" instructions. This
 * recovers the JSON object/array without throwing.
 */
export function extractJson(raw: string): string {
  const trimmed = raw.trim();

  // Fast path: already valid JSON.
  try {
    JSON.parse(trimmed);
    return trimmed;
  } catch {
    // fall through to extraction
  }

  // Strip fenced blocks: ```json\n{...}\n``` or ```\n[...]\n```
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch?.[1]) {
    const inner = fenceMatch[1].trim();
    try {
      JSON.parse(inner);
      return inner;
    } catch {
      // continue to bracket extraction
    }
  }

  // Extract the outermost {...} or [...] span.
  const firstBrace = trimmed.search(/[[{]/);
  if (firstBrace !== -1) {
    const opener = trimmed[firstBrace];
    const closer = opener === '{' ? '}' : ']';
    const lastClose = trimmed.lastIndexOf(closer);
    if (lastClose > firstBrace) {
      const slice = trimmed.slice(firstBrace, lastClose + 1);
      try {
        JSON.parse(slice);
        return slice;
      } catch {
        // give up below
      }
    }
  }

  // Return as-is; the caller's JSON.parse will throw a clear error.
  return trimmed;
}
