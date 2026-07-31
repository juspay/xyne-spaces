/**
 * Codex (OpenAI Codex CLI/TUI) rollout parser.
 *
 * Input is JSONL. Typical lines:
 *   {"type":"session_meta","payload":{"session_id":"...",...}}
 *   {"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"..."}]}}
 *   {"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."},{"type":"tool_call","name":"..."}]}}
 *   {"type":"event_msg","payload":{"type":"task_started"}}
 *
 * We treat `session_meta` as the envelope (and reject a file without it),
 * keep `response_item` messages with role user/assistant, drop developer
 * instructions and housekeeping `event_msg` lines, and render tool_call /
 * tool_output content items.
 */

import { clip, isRecord, safeJson } from "./common.js";
import type { ParsedSession } from "./types.js";

const MAX_TURN_CHARS = 8_000;

type CodexRole = "user" | "assistant" | "developer" | "system";

function normalizeRole(role: unknown): CodexRole | null {
  const r = typeof role === "string" ? role.toLowerCase() : "";
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "ai") return "assistant";
  if (r === "developer" || r === "system") return "developer";
  return null;
}

interface ContentItem extends Record<string, unknown> {
  type?: unknown;
  text?: unknown;
}

function isContentItemArray(v: unknown): v is ContentItem[] {
  return Array.isArray(v);
}

function renderContentItem(item: ContentItem): { text: string; toolName: string | null; callId: string | null } {
  const type = typeof item.type === "string" ? item.type : "";
  switch (type) {
    case "input_text":
    case "output_text":
    case "text": {
      const text = typeof item.text === "string" ? item.text : "";
      return { text, toolName: null, callId: null };
    }
    case "tool_call": {
      const name = typeof item.name === "string" ? item.name : "(unnamed tool)";
      const callId = typeof item.call_id === "string" ? item.call_id : "";
      const args = safeJson(item.arguments ?? item.args);
      return { text: `[tool_call ${name}${callId ? ` id=${callId}` : ""}] args: ${clip(args, 800)}`, toolName: name, callId };
    }
    case "tool_output": {
      const callId = typeof item.call_id === "string" ? item.call_id : "";
      const output = typeof item.output === "string" ? item.output : safeJson(item.output);
      return { text: `[tool_output${callId ? ` id=${callId}` : ""}] ${output}`, toolName: null, callId };
    }
    default:
      return { text: "", toolName: null, callId: null };
  }
}

interface RenderedMessage {
  text: string;
  tools: string[];
}

function renderMessage(role: CodexRole, content: unknown): RenderedMessage | null {
  if (!isContentItemArray(content)) return null;
  const parts: string[] = [];
  const tools: string[] = [];
  for (const item of content) {
    const { text, toolName } = renderContentItem(item);
    if (text) parts.push(text);
    if (toolName) tools.push(toolName);
  }
  if (parts.length === 0 && tools.length === 0) return null;
  return { text: parts.join("\n"), tools };
}

interface NormalizedTurn {
  role: "user" | "assistant";
  text: string;
}

function parseMessageFromPayload(payload: Record<string, unknown>): NormalizedTurn | null {
  const type = typeof payload.type === "string" ? payload.type : "";
  if (type !== "message") return null;

  const role = normalizeRole(payload.role);
  if (role !== "user" && role !== "assistant") return null;

  const rendered = renderMessage(role, payload.content);
  if (!rendered || (!rendered.text && rendered.tools.length === 0)) return null;
  return { role, text: clip(rendered.text, MAX_TURN_CHARS) };
}

export function detectCodex(raw: string): boolean {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return false;
  let hasSessionMeta = false;
  let hasResponseItem = false;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as unknown;
      if (!isRecord(obj)) continue;
      if (obj["type"] === "session_meta") hasSessionMeta = true;
      if (obj["type"] === "response_item") hasResponseItem = true;
    } catch {
      // Ignore malformed lines for detection purposes.
    }
  }
  return hasSessionMeta && hasResponseItem;
}

/**
 * Parse a Codex rollout JSONL stream into the shared shape.
 * Never throws.
 */
export function parseCodexSession(raw: string, _filename?: string): ParsedSession {
  const empty = (format: string): ParsedSession => ({
    task: "",
    result: "",
    toolsUsed: [],
    transcript: "",
    turnCount: 0,
    conversationCount: 1,
    format,
    source: "codex",
  });

  const trimmed = (raw ?? "").trim();
  if (!trimmed) return empty("unknown");

  const turns: NormalizedTurn[] = [];
  const tools = new Set<string>();
  let hasSessionMeta = false;

  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as unknown;
      if (!isRecord(obj)) continue;
      const type = typeof obj["type"] === "string" ? obj["type"] : "";
      if (type === "session_meta") {
        hasSessionMeta = true;
        continue;
      }
      if (type === "response_item" && isRecord(obj["payload"])) {
        const payload = obj["payload"] as Record<string, unknown>;
        const content = payload["content"];
        if (isContentItemArray(content)) {
          for (const item of content) {
            const { toolName } = renderContentItem(item);
            if (toolName) tools.add(toolName);
          }
        }
        const turn = parseMessageFromPayload(payload);
        if (turn) turns.push(turn);
      }
    } catch {
      continue;
    }
  }

  if (!hasSessionMeta) return empty("codex-jsonl");
  if (turns.length === 0) return empty("codex-jsonl");

  const firstUser = turns.find((t) => t.role === "user");
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");

  const task = firstUser ? clip(firstUser.text, 4_000) : "(no user turn found in session)";
  const result = lastAssistant ? clip(lastAssistant.text, 4_000) : "(no assistant turn found in session)";

  const transcript = turns.map((t) => `### ${t.role.toUpperCase()}\n${t.text}`).join("\n\n");

  return {
    task,
    result,
    toolsUsed: [...tools],
    transcript,
    turnCount: turns.length,
    conversationCount: 1,
    format: "codex-jsonl",
    source: "codex",
  };
}
