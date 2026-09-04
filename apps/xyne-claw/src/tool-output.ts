/**
 * Shared tool-output guards, used by BOTH the MCP wrapper (mcp.ts) and the
 * custom/sandbox tool wrapper (agent.ts). Two concerns:
 *
 *  1. Spill-to-file for over-large output. pi-coding-agent promotes over-large
 *     output to a temp file for its OWN built-in tools (bash/read/grep/...), but
 *     MCP and custom tools take the `customTools` path and never reach that
 *     layer. Without this, a sandbox grep or an MCP `list_resources` returning
 *     tens of MB blows the model's context window in a single turn (observed:
 *     euler/codex runs going empty after a heavy investigation). We dump the
 *     full result to `.context/tool-results/` and hand the model a small preview
 *     plus the relative path, so NOTHING is lost — it can `read`/`grep` the file
 *     on demand or re-call the tool with narrower filters.
 *
 *     The spilled file MUST be line-structured. pi-coding-agent's built-in
 *     `read` tool paginates by LINE (offset/limit are line numbers) with a
 *     ~50KB per-line cap, and `grep` is line-oriented too. A tool that returns
 *     minified JSON on a SINGLE physical line (e.g. a 422KB one-line MCP result)
 *     therefore cannot be paged or grepped at all — the model can only ever see
 *     the first ~50KB and can never parse/count/pivot the rest. `lineifyForSpill`
 *     reflows such output (JSON → JSON-Lines / pretty-print, otherwise hard-wrap)
 *     BEFORE it is written, so the spilled file is always paginable. See F1 in
 *     the Pi-Alerts architecture review.
 *
 *  2. NUL / control-byte stripping. Postgres `jsonb` rejects U+0000, and control
 *     bytes from binary-ish tool output both bloat context and break the
 *     downstream invocation persistence. Stripped before anything stores them.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join as joinPath, resolve as resolvePath } from "node:path";
import { metric } from "./metrics.js";

import { createLogger } from "./logger.js";
const log = createLogger("tool-output");

// MCP/custom tool results are often structure-heavy JSON, so we use a tighter
// cap than pi's 50KB bash default — the model skims more tokens per useful fact.
export const TOOL_RESULT_INLINE_CAP_BYTES = Number(process.env["XYNE_CLAW_TOOL_RESULT_INLINE_CAP_BYTES"] ?? 32 * 1024);
// Search/retrieval tools (kb-search, spaces-search, spaces-* reads, genius-*,
// query-codebase, web-search, deep-research, memory-search) return exactly the
// evidence the model must reason over. Spilling that to a file behind a 2KB
// preview makes the model answer from the preview alone — the single biggest
// grounding leak. Give them a MUCH larger inline cap so the full ranked result
// set stays in context. Bulk/file tools (bash, read, grep, list_resources, …)
// keep the small cap above. Kept moderate (128KB ≈ ~32K tokens) so several
// retrieval calls in one turn don't blow a 128K-window model before compaction.
export const TOOL_RESULT_RETRIEVAL_CAP_BYTES = Number(process.env["XYNE_CLAW_TOOL_RESULT_RETRIEVAL_CAP_BYTES"] ?? 128 * 1024);
// Preview shown inline before the path, so the model can often answer without
// reading the file at all. Retrieval tools that DO still exceed their (large)
// cap get a bigger preview so more top-N ranked hits survive inline.
const TOOL_RESULT_PREVIEW_BYTES = 2 * 1024;
const TOOL_RESULT_RETRIEVAL_PREVIEW_BYTES = 16 * 1024;

// Maximum characters allowed on a single physical line in a spilled file.
// pi-coding-agent's built-in `read` paginates by line and caps a single line at
// ~50KB, and `grep` returns whole matching lines; a minified 422KB one-liner is
// therefore unreadable. We reflow any line longer than this before writing so
// the spilled file is always paginable/greppable. Well under pi's 50KB line cap
// and large enough that one JSON record almost always fits on one line.
export const SPILL_MAX_LINE_CHARS = Number(process.env["XYNE_CLAW_SPILL_MAX_LINE_CHARS"] ?? 4 * 1024);

// Tool names (NOT server-prefixed — promoteIfOversized receives the bare
// mcpTool.name / custom-tool slug) that should get the larger retrieval cap.
const RETRIEVAL_TOOL_NAMES: ReadonlySet<string> = new Set([
  "kb-search",
  "spaces-search",
  "spaces-research",
  "memory-search",
  "query-codebase",
  "web-search",
  "deep-research",
  "genius-analytics",
  "genius-investigation",
  // File/email content reads — grounding evidence the model reasons over, same
  // as a retrieval result. They no longer hard-truncate internally; the full
  // body flows here and spills to a file behind a preview past this larger cap.
  "google-gmail-read",
  "google-gmail-attachment",
  "google-drive-read",
  "microsoft-onedrive-read",
  "microsoft-outlook-read",
]);

/**
 * True when `toolName` is a search/retrieval tool that should keep its full
 * result inline. Matches the explicit set above OR sensible prefixes/substrings
 * so future retrieval tools are covered without editing this list. Bulk/file
 * tools (bash/read/grep/list_resources/fetch-attachment/…) do NOT match.
 */
export function isRetrievalTool(toolName: string): boolean {
  const n = toolName.toLowerCase();
  if (RETRIEVAL_TOOL_NAMES.has(n)) return true;
  return (
    n.startsWith("kb-") ||
    n.startsWith("spaces-") ||
    n.startsWith("genius-") ||
    n.startsWith("query-codebase") ||
    n.includes("search") ||
    n.includes("research")
  );
}

/** Inline byte cap for a given tool: large for retrieval tools, small otherwise. */
export function inlineCapForTool(toolName: string): number {
  return isRetrievalTool(toolName) ? TOOL_RESULT_RETRIEVAL_CAP_BYTES : TOOL_RESULT_INLINE_CAP_BYTES;
}

/** Strip NUL + other C0 control chars (keep tab, newline, carriage-return). */
export function stripControlChars(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Break any physical line longer than `width` into `width`-sized chunks. */
function hardWrapLongLines(text: string, width: number): string {
  if (width <= 0) return text;
  const out: string[] = [];
  for (const line of text.split("\n")) {
    if (line.length <= width) {
      out.push(line);
      continue;
    }
    for (let i = 0; i < line.length; i += width) {
      out.push(line.slice(i, i + width));
    }
  }
  return out.join("\n");
}

/**
 * Reflow spill content so no physical line exceeds `maxLineChars`, making it
 * safe for the line-oriented `read`/`grep` tools.
 *
 *  - JSON array  → JSON-Lines (one element per line) so the model can page,
 *    grep, and count records.
 *  - JSON object → 2-space pretty-print so keys are addressable by line.
 *  - anything else (incl. JSON that still has an over-long line, e.g. a giant
 *    string value) → hard-wrap the long lines.
 *
 * No-ops (returns the input unchanged) when every line is already within
 * `maxLineChars`, so it is idempotent and cheap for already-structured output.
 * Never throws — on any parse/reserialization failure it falls back to a plain
 * hard-wrap so a spill is never lost.
 */
export function lineifyForSpill(content: string, maxLineChars: number = SPILL_MAX_LINE_CHARS): string {
  // Only worth touching when a pathologically long physical line exists.
  const hasLongLine = content.split("\n").some((l) => l.length > maxLineChars);
  if (!hasLongLine) return content;

  const trimmed = content.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    try {
      const parsed = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        const jsonl = parsed.map((el) => JSON.stringify(el)).join("\n");
        return hardWrapLongLines(jsonl, maxLineChars);
      }
      if (parsed && typeof parsed === "object") {
        return hardWrapLongLines(JSON.stringify(parsed, null, 2), maxLineChars);
      }
      // primitive JSON (number/string/bool) — just wrap.
    } catch {
      // Not valid JSON despite the leading bracket — fall through to hard-wrap.
    }
  }
  return hardWrapLongLines(content, maxLineChars);
}

/**
 * If `rawContent` is over the inline cap, dump it to
 * `<outputBaseDir>/.context/tool-results/<category>-<toolName>-<ts>.json` and
 * return a preview + the ABSOLUTE path. Otherwise return it unchanged.
 *
 * `outputBaseDir` should be the PERSISTENT session dir (not the ephemeral
 * per-run workspace) whenever a conversation is in play — see
 * session-store.ts `toolOutputBaseDir`. The per-run workspace is deleted at
 * the end of every /run and recreated fresh on resume, so a file written there
 * (and the relative path the model carries in its restored session) no longer
 * resolves on the next turn — the exact failure that made resumed runs report
 * "the uploaded log file is not readable from my current context". The session
 * dir is archived to GCS and restored on resume / cross-pod, and sits under the
 * same host data mount the sandbox sees, so an ABSOLUTE path stays valid for
 * the read/grep tools (which read absolute paths directly — no cwd containment)
 * and for the sandbox across turns.
 *
 * Always strips control bytes first, then line-structures the payload via
 * `lineifyForSpill` so the spilled file is paginable by the line-oriented
 * read/grep tools. On a disk-write failure, falls back to an inline head with a
 * clear truncation note rather than dropping silently.
 */
export async function promoteIfOversized(
  outputBaseDir: string,
  category: string,
  toolName: string,
  rawContent: string,
  // Optional per-call inline cap. Defaults to the tool-aware resolver so search/
  // retrieval tools keep their full result inline while bulk/file tools spill at
  // the small cap. Callers may pass an explicit value to override.
  inlineCapBytes?: number,
  // When true, persist the raw result to a file even when it fits inline, and
  // hand the model the path — so it can forward the whole file into a sandbox
  // byte-for-byte (sandbox-copy-in contextPath) instead of retyping it.
  forceFile = false,
): Promise<string> {
  const cap = inlineCapBytes ?? inlineCapForTool(toolName);
  const clean = stripControlChars(rawContent);
  if (clean.length <= cap) {
    if (!forceFile) return clean;
    const dir = resolvePath(outputBaseDir, ".context", "tool-results");
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const absPath = joinPath(
      dir,
      `${category.replace(/[^a-zA-Z0-9_-]/g, "_")}-${toolName.replace(/[^a-zA-Z0-9_-]/g, "_")}-${stamp}.json`,
    );
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(absPath, clean, { encoding: "utf8" });
    } catch {
      return clean;
    }
    return `${clean}\n\n[Full raw result also saved to ${absPath} — to use it in a sandbox, forward the whole file with sandbox-copy-in (contextPath) instead of pasting its content.]`;
  }
  // Reflow to line-structured form so the spilled file is readable/greppable by
  // the line-oriented read/grep tools (a minified single-line JSON payload is
  // otherwise unusable — see lineifyForSpill / F1).
  const lined = lineifyForSpill(clean);
  // Retrieval tools that STILL overflow get a larger preview so more ranked hits
  // survive inline even after the spill.
  const previewBytes = isRetrievalTool(toolName)
    ? TOOL_RESULT_RETRIEVAL_PREVIEW_BYTES
    : TOOL_RESULT_PREVIEW_BYTES;
  const safeCategory = category.replace(/[^a-zA-Z0-9_-]/g, "_");
  const safeTool = toolName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  // resolvePath (not joinPath) so the path is genuinely ABSOLUTE even when
  // PATHS.dataDir is relative ("./data" default) — outputBaseDir is then
  // sessions/<key> (relative), and a relative path handed to the model gets
  // re-resolved by the scoped read tool against the SANDBOX workingDir, not the
  // claw process CWD → the file is written under /app/xyne-claw/data/... but
  // read-resolved under /app/xyne-claw/data/workspaces/<id>/data/... → ENOENT.
  // An absolute path is checked as-is by the read gate and matches the (already
  // absolute-resolved) .context read roots.
  const dir = resolvePath(outputBaseDir, ".context", "tool-results");
  const absPath = joinPath(dir, `${safeCategory}-${safeTool}-${stamp}.json`);
  try {
    await mkdir(dir, { recursive: true });
    await writeFile(absPath, lined, { encoding: "utf8" });
  } catch (err) {
    const truncated = lined.slice(0, cap);
    return [
      `[Tool returned ${clean.length} chars — full result could not be saved to disk:`,
      `   ${err instanceof Error ? err.message : String(err)}`,
      `   Showing only the first ${cap} chars; the tail was dropped.]`,
      ``,
      truncated,
    ].join("\n");
  }
  const preview = lined.slice(0, previewBytes);
  metric.count("tool_output_spill", { category: safeCategory, tool: safeTool });
  metric.observe("tool_output_spill_bytes", clean.length, { category: safeCategory, tool: safeTool });
  log.info(`[tool-output] ${safeCategory}/${safeTool} result ${clean.length}b → ${absPath} (cap ${cap}b)`);
  return [
    `[Tool returned ${clean.length} chars — full result saved to ${absPath}.`,
    `Use the read tool on that absolute path (with offset/limit) or grep on it to inspect.`,
    `If you're looking for specific entries, consider re-calling the tool with narrower filters.]`,
    ``,
    `## Preview (first ${previewBytes} chars)`,
    preview,
  ].join("\n");
}
