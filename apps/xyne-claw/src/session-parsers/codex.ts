/**
 * Codex (OpenAI Codex CLI/TUI) rollout parser.
 *
 * Shapes verified against REAL rollout-*.jsonl files (2026-08, cli 0.5x):
 *
 *   {"type":"session_meta","payload":{"session_id":"...","cwd":"...","originator":"codex-tui","cli_version":"..."}}
 *   {"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"..."}]}}
 *   {"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}}
 *   {"type":"response_item","payload":{"type":"function_call","name":"shell","arguments":"{...}","call_id":"..."}}
 *   {"type":"response_item","payload":{"type":"function_call_output","call_id":"...","output":"..."}}
 *   {"type":"response_item","payload":{"type":"custom_tool_call","name":"...","input":"...","call_id":"..."}}
 *   {"type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"...","output":"..."}}
 *   {"type":"response_item","payload":{"type":"reasoning",...}}          ← dropped
 *   {"type":"event_msg","payload":{"type":"task_started"}}               ← dropped (housekeeping)
 *
 * CRITICAL: tool activity is NOT content items inside messages — it is
 * separate response_item payload types (a real session has hundreds of
 * custom_tool_call/function_call lines). The first parser version only read
 * `payload.type === "message"` and silently dropped every tool event, so
 * donated sessions distilled to prose-only with toolsUsed=[].
 *
 * Older Codex CLI versions predate the {type,payload} wrapper: the first line
 * is a bare SessionMeta and subsequent lines are bare ResponseItems. Both
 * layouts are handled — the item extractor takes wrapped payloads or bare
 * lines equally.
 *
 * Real rollouts also inject <environment_context>/<user_instructions> blobs
 * as user-role messages BEFORE the human's prompt; those are scaffolding, not
 * the task, and are skipped so `task` is the user's actual request.
 */

import {
  clip,
  finalizeSession,
  isRecord,
  safeJson,
  TOOL_INPUT_CLIP,
  TOOL_OUTPUT_CLIP,
  type NormalizedTurn,
} from "./common.js";
import type { ParsedSession } from "./types.js";

type CodexRole = "user" | "assistant" | "developer" | "system";

function normalizeRole(role: unknown): CodexRole | null {
  const r = typeof role === "string" ? role.toLowerCase() : "";
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "ai") return "assistant";
  if (r === "developer" || r === "system") return "developer";
  return null;
}

/** Harness scaffolding injected as user messages — never the actual task. */
const SCAFFOLDING_PREFIXES = ["<environment_context>", "<user_instructions>", "<turn_context>", "<permissions"];

function isScaffolding(text: string): boolean {
  const head = text.trimStart().slice(0, 40).toLowerCase();
  return SCAFFOLDING_PREFIXES.some((p) => head.startsWith(p));
}

/** Payload types that carry a tool invocation (name + args). */
const TOOL_CALL_TYPES = new Set(["function_call", "custom_tool_call", "local_shell_call"]);
/** Payload types that carry a tool result. */
const TOOL_OUTPUT_TYPES = new Set(["function_call_output", "custom_tool_call_output", "local_shell_call_output"]);

interface ExtractedItem {
  turn: NormalizedTurn | null;
  toolName: string | null;
}

function extractText(content: unknown): { text: string; legacyTools: string[]; hasProse: boolean } {
  const parts: string[] = [];
  const legacyTools: string[] = [];
  let hasProse = false;
  if (!Array.isArray(content)) return { text: "", legacyTools, hasProse };
  for (const item of content) {
    if (!isRecord(item)) continue;
    const type = typeof item["type"] === "string" ? item["type"] : "";
    if (type === "input_text" || type === "output_text" || type === "text") {
      const text = typeof item["text"] === "string" ? item["text"] : "";
      if (text) {
        parts.push(text);
        hasProse = true;
      }
    } else if (type === "tool_call") {
      // Legacy/defensive: some payloads may inline tool calls as content.
      const name = typeof item["name"] === "string" ? item["name"] : "(unnamed tool)";
      parts.push(`[tool_call ${name}] args: ${clip(safeJson(item["arguments"] ?? item["args"]), TOOL_INPUT_CLIP)}`);
      legacyTools.push(name);
    } else if (type === "tool_output") {
      const output = typeof item["output"] === "string" ? item["output"] : safeJson(item["output"]);
      parts.push(`[tool_output] ${clip(output, TOOL_OUTPUT_CLIP)}`);
    }
    // input_image and unknown types are dropped.
  }
  return { text: parts.join("\n"), legacyTools, hasProse };
}

/**
 * Turn a ResponseItem payload (wrapped or bare) into a normalized turn.
 * Returns null for reasoning/housekeeping/unrenderable items.
 */
function extractItem(payload: Record<string, unknown>): ExtractedItem {
  const type = typeof payload["type"] === "string" ? payload["type"] : "";

  if (type === "message") {
    const role = normalizeRole(payload["role"]);
    if (role !== "user" && role !== "assistant") return { turn: null, toolName: null };
    const { text, legacyTools, hasProse } = extractText(payload["content"]);
    if (!text) return { turn: null, toolName: legacyTools[0] ?? null };
    if (role === "user" && isScaffolding(text)) return { turn: null, toolName: null };
    // A "message" whose content is exclusively tool markers is tool traffic,
    // not prose — keep it out of the assistant lane so it can never be `result`.
    const turnRole = hasProse ? role : role === "assistant" ? ("tool" as const) : role;
    return { turn: { role: turnRole, text }, toolName: legacyTools[0] ?? null };
  }

  if (TOOL_CALL_TYPES.has(type)) {
    const name =
      typeof payload["name"] === "string" && payload["name"].trim()
        ? payload["name"].trim()
        : type === "local_shell_call"
          ? "shell"
          : "(unnamed tool)";
    const args = safeJson(payload["arguments"] ?? payload["input"] ?? payload["action"]);
    const callId = typeof payload["call_id"] === "string" ? payload["call_id"] : "";
    return {
      turn: { role: "tool", text: `[tool_call ${name}${callId ? ` id=${callId}` : ""}] args: ${clip(args, TOOL_INPUT_CLIP)}` },
      toolName: name,
    };
  }

  if (TOOL_OUTPUT_TYPES.has(type)) {
    const rawOutput = payload["output"];
    const output = typeof rawOutput === "string" ? rawOutput : safeJson(rawOutput);
    const callId = typeof payload["call_id"] === "string" ? payload["call_id"] : "";
    if (!output) return { turn: null, toolName: null };
    return {
      turn: { role: "tool", text: `[tool_output${callId ? ` id=${callId}` : ""}] ${clip(output, TOOL_OUTPUT_CLIP)}` },
      toolName: null,
    };
  }

  // reasoning / token_count / task_started / everything else: dropped.
  return { turn: null, toolName: null };
}

const WRAPPER_TYPES = new Set([
  "session_meta",
  "response_item",
  "event_msg",
  "turn_context",
  "world_state",
  "compacted",
]);

/** Bare (old-format) SessionMeta: first object with id + timestamp, no wrapper type. */
function isBareSessionMeta(obj: Record<string, unknown>): boolean {
  return (
    typeof obj["id"] === "string" &&
    typeof obj["timestamp"] === "string" &&
    !("type" in obj) &&
    ("cwd" in obj || "instructions" in obj || "git" in obj || "cli_version" in obj || "originator" in obj)
  );
}

/** Cap detection work — a marker in a real rollout appears within the first lines. */
const DETECT_MAX_LINES = 200;

export function detectCodex(raw: string): boolean {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return false;
  let seen = 0;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    if (++seen > DETECT_MAX_LINES) break;
    try {
      const obj = JSON.parse(line) as unknown;
      if (!isRecord(obj)) continue;
      const type = obj["type"];
      // New format: wrapper markers are decisive on their own.
      if (type === "session_meta" || type === "response_item" || type === "event_msg") return true;
      // Old format: bare SessionMeta first line.
      if (isBareSessionMeta(obj)) return true;
    } catch {
      // Ignore malformed lines for detection purposes.
    }
  }
  return false;
}

/**
 * Parse a Codex rollout JSONL stream (new wrapped or old bare layout) into
 * the shared shape. Never throws.
 */
export function parseCodexSession(raw: string): ParsedSession {
  const trimmed = (raw ?? "").trim();
  const turns: NormalizedTurn[] = [];
  const tools = new Set<string>();

  if (trimmed) {
    for (const line of trimmed.split(/\r?\n/)) {
      if (!line.trim()) continue;
      let obj: unknown;
      try {
        obj = JSON.parse(line);
      } catch {
        continue;
      }
      if (!isRecord(obj)) continue;

      let payload: Record<string, unknown> | null = null;
      const wrapperType = typeof obj["type"] === "string" ? obj["type"] : "";
      if (wrapperType === "response_item" && isRecord(obj["payload"])) {
        payload = obj["payload"] as Record<string, unknown>;
      } else if (WRAPPER_TYPES.has(wrapperType)) {
        continue; // session_meta / event_msg / housekeeping wrappers
      } else if (isBareSessionMeta(obj)) {
        continue; // old-format meta line
      } else if (wrapperType) {
        // Old format: the line IS the ResponseItem ({type:"message"|"function_call"|...}).
        payload = obj;
      }
      if (!payload) continue;

      const { turn, toolName } = extractItem(payload);
      if (toolName) tools.add(toolName);
      if (turn) turns.push(turn);
    }
  }

  return finalizeSession({ turns, tools, format: "codex-jsonl", source: "codex" });
}
