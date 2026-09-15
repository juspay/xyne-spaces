/**
 * OpenCode session parser.
 *
 * Shapes verified against REAL OpenCode storage (~/.local/share/opencode):
 * `opencode export` emits `{ info: {...session}, messages: [{ info: {...message,
 * role}, parts: [...] }] }` — the role lives on `message.info.role`, and tool
 * parts carry their I/O under `part.state`:
 *
 *   { "type": "tool", "tool": "bash", "callID": "...",
 *     "state": { "status": "completed", "input": {...}, "output": "..." } }
 *
 * Other real part types: "text" {text}, "reasoning", "step-start",
 * "step-finish", "patch", "file", "subtask".
 *
 * The first parser version read `msg.role` and `part.input`/`part.output` at
 * the top level — a shape only its own test fixture had — so real exports
 * parsed to zero turns (422) or tool parts with no data. Both layouts are
 * accepted now: `info.role` first with top-level `role` as fallback, and
 * `state.{input,output}` first with top-level fallbacks.
 */

import {
  clip,
  extractTopLevelString,
  finalizeSession,
  isRecord,
  safeJson,
  TOOL_INPUT_CLIP,
  TOOL_OUTPUT_CLIP,
  type NormalizedTurn,
} from "./common.js";
import type { ParsedSession } from "./types.js";

const MAX_FILE_SNIPPET_LEN = 400;

type OpenCodeRole = "user" | "assistant" | "system";

function normalizeRole(role: unknown): OpenCodeRole | null {
  const r = typeof role === "string" ? role.toLowerCase() : "";
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "ai" || r === "model") return "assistant";
  if (r === "system" || r === "developer") return "system";
  return null;
}

function renderFilePart(p: Record<string, unknown>): string {
  const name =
    extractTopLevelString(p, ["filename", "name", "file", "path"]) || "(unnamed file)";
  return `[file: ${clip(name, MAX_FILE_SNIPPET_LEN)}]`;
}

function renderToolPart(p: Record<string, unknown>): { text: string; toolName: string | null } {
  const toolName = typeof p["tool"] === "string" && p["tool"].trim() ? (p["tool"] as string) : "(unnamed tool)";
  // Real exports nest I/O under part.state; the legacy bundle fixture put it
  // at the top level. Prefer state, fall back.
  const state = isRecord(p["state"]) ? (p["state"] as Record<string, unknown>) : undefined;
  const input = safeJson(state?.["input"] ?? p["input"]);
  const output = safeJson(state?.["output"] ?? p["output"]);
  const status = typeof state?.["status"] === "string" ? (state["status"] as string) : "";
  const pieces: string[] = [`[tool ${toolName}${status && status !== "completed" ? ` (${status})` : ""}]`];
  if (input) pieces.push(`input: ${clip(input, TOOL_INPUT_CLIP)}`);
  if (output) pieces.push(`output: ${clip(output, TOOL_OUTPUT_CLIP)}`);
  return { text: pieces.join(" "), toolName };
}

/**
 * Render one part. Tool parts are reported separately so the caller can route
 * them into a TOOL turn (never assistant prose) and harvest the tool name from
 * the SAME render pass — the previous separate harvest loop could disagree
 * with what the transcript showed.
 */
function renderPart(part: unknown): { text: string; toolName: string | null } {
  if (!isRecord(part)) return { text: "", toolName: null };
  const type = typeof part["type"] === "string" ? (part["type"] as string) : "";
  switch (type) {
    case "text": {
      const text = typeof part["text"] === "string" ? (part["text"] as string) : "";
      return { text, toolName: null };
    }
    case "file":
      return { text: renderFilePart(part), toolName: null };
    case "tool":
      return renderToolPart(part);
    case "patch":
      return { text: "[patch applied]", toolName: null };
    case "reasoning":
    case "step-start":
    case "step-finish":
    case "snapshot":
      return { text: "", toolName: null };
    default: {
      const text = typeof part["text"] === "string" ? (part["text"] as string) : "";
      return { text, toolName: null };
    }
  }
}

function messageRole(msg: Record<string, unknown>): OpenCodeRole | null {
  // Real export: role on message.info; legacy bundle: role on the message.
  if (isRecord(msg["info"])) {
    const fromInfo = normalizeRole((msg["info"] as Record<string, unknown>)["role"]);
    if (fromInfo) return fromInfo;
  }
  return normalizeRole(msg["role"]);
}

/**
 * A message becomes 1-2 turns: its prose (role user/assistant) and, when it
 * carries tool parts, a separate TOOL turn — so tool output never leaks into
 * `result` selection.
 */
function turnsFromMessage(msg: Record<string, unknown>): { turns: NormalizedTurn[]; tools: string[] } {
  const role = messageRole(msg);
  if (!role || role === "system") return { turns: [], tools: [] };

  const parts = Array.isArray(msg["parts"]) ? (msg["parts"] as unknown[]) : [];
  const prose: string[] = [];
  const toolTexts: string[] = [];
  const tools: string[] = [];
  for (const part of parts) {
    const { text, toolName } = renderPart(part);
    if (toolName) {
      tools.push(toolName);
      if (text.trim()) toolTexts.push(text.trim());
    } else if (text.trim()) {
      prose.push(text.trim());
    }
  }

  const turns: NormalizedTurn[] = [];
  if (toolTexts.length > 0) turns.push({ role: "tool", text: toolTexts.join("\n") });
  if (prose.length > 0) turns.push({ role, text: prose.join("\n") });
  return { turns, tools };
}

export function detectOpenCode(raw: string): boolean {
  const trimmed = (raw ?? "").trim();
  if (!trimmed || trimmed[0] !== "{") return false;
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (!isRecord(obj)) return false;

    // Primary: explicit format declaration.
    if (obj["format"] === "opencode-session-bundle") return true;

    // Secondary: shape heuristic matching `opencode export` output.
    if (
      isRecord(obj["info"]) &&
      typeof (obj["info"] as Record<string, unknown>)["id"] === "string" &&
      ((obj["info"] as Record<string, unknown>)["id"] as string).startsWith("ses_") &&
      Array.isArray(obj["messages"])
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Parse an OpenCode export / session bundle into the shared shape.
 * Never throws; empty parses return turnCount 0 / conversationCount 0.
 */
export function parseOpenCodeSession(raw: string): ParsedSession {
  const trimmed = (raw ?? "").trim();
  const turns: NormalizedTurn[] = [];
  const tools = new Set<string>();
  let title = "";

  if (trimmed) {
    let envelope: unknown;
    try {
      envelope = JSON.parse(trimmed);
    } catch {
      envelope = null;
    }
    if (isRecord(envelope)) {
      if (isRecord(envelope["info"])) {
        title = extractTopLevelString(envelope["info"] as Record<string, unknown>, ["title", "slug", "description"]);
      }
      const messages = Array.isArray(envelope["messages"]) ? (envelope["messages"] as unknown[]) : [];
      for (const m of messages) {
        if (!isRecord(m)) continue;
        const { turns: msgTurns, tools: msgTools } = turnsFromMessage(m);
        turns.push(...msgTurns);
        for (const t of msgTools) tools.add(t);
      }
    }
  }

  return finalizeSession({ turns, tools, format: "opencode-json", source: "opencode", taskFallback: title });
}
