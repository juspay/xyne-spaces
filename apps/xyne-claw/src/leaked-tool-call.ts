/**
 * Recover tool arguments a model leaked into message text instead of emitting a
 * proper tool_call. glm-via-LiteLLM intermittently does this — the content
 * carries the args as GLM native markup or as a JSON object. Shared by the
 * twin respond-gate and the twin_deliver recovery path.
 */

/** Parse GLM native tool-call markup — `<arg_key>K</arg_key><arg_value>V</arg_value>`
 *  pairs — into a key/value map (non-greedy, both trimmed). A repeated key
 *  overwrites the earlier one; empty keys are skipped. */
export function parseArgMarkup(text: string): Record<string, string> {
  const pairRe = /<arg_key>\s*([\s\S]*?)\s*<\/arg_key>\s*<arg_value>\s*([\s\S]*?)\s*<\/arg_value>/gi;
  const out: Record<string, string> = {};
  let m: RegExpExecArray | null;
  while ((m = pairRe.exec(text)) !== null) {
    const key = m[1]?.trim();
    if (key) out[key] = (m[2] ?? "").trim();
  }
  return out;
}

/** JSON.parse that yields only a plain object (not null / array / scalar) and
 *  null on anything unparsable. Does not trim or otherwise touch its input. */
export function parseJsonObject(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
