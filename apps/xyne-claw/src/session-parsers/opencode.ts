/**
 * OpenCode session parser.
 *
 * Targets the OpenCode session bundle export: a JSON object that typically
 * carries `format: "opencode-session-bundle"`, a top-level `messages` array,
 * and message parts typed as `text`, `tool`, `step-start`, `step-finish`,
 * or `file`.
 *
 * Detection is heuristic — we prefer the declared format and fall back to a
 * shape-based check (`info.id` starts with `ses_` plus a messages array whose
 * items have `role` and `parts`).
 */

import { clip, extractTopLevelString, isRecord, joinNonEmpty, safeJson } from "./common.js";
import type { ParsedSession } from "./types.js";

const MAX_TURN_CHARS = 8_000;
const MAX_FILE_SNIPPET_LEN = 400;

type OpenCodeRole = "user" | "assistant" | "system";
type OpenCodePart =
  | { type: "text"; text?: string }
  | { type: "file"; filename?: string; path?: string }
  | { type: "tool"; tool?: string; input?: unknown; output?: unknown }
  | { type: "step-start"; label?: string }
  | { type: "step-finish"; label?: string }
  | Record<string, unknown>;

function normalizeRole(role: unknown): OpenCodeRole | null {
  const r = typeof role === "string" ? role.toLowerCase() : "";
  if (r === "user" || r === "human") return "user";
  if (r === "assistant" || r === "ai" || r === "model") return "assistant";
  if (r === "system" || r === "developer") return "system";
  return null;
}

function isOpenCodePartArray(v: unknown): v is OpenCodePart[] {
  return Array.isArray(v);
}

function renderFilePart(part: Record<string, unknown>): string {
  const p = part as Record<string, unknown>;
  const name =
    extractTopLevelString(p, ["filename", "name", "file", "path"]) ||
    (typeof p["path"] === "string" ? (p["path"] as string) : "(unnamed file)");
  return `[file: ${clip(name, MAX_FILE_SNIPPET_LEN)}]`;
}

function renderToolPart(part: Record<string, unknown>): { text: string; toolName: string | null } {
  const p = part as Record<string, unknown>;
  const toolName = typeof p["tool"] === "string" ? (p["tool"] as string) : "(unnamed tool)";
  const input = safeJson(p["input"]);
  const output = safeJson(p["output"]);
  const pieces: string[] = [`[tool ${toolName}]`];
  if (input) pieces.push(`input: ${clip(input, 800)}`);
  if (output) pieces.push(`output: ${clip(output, MAX_TURN_CHARS)}`);
  return { text: pieces.join(" "), toolName };
}

function renderPart(part: OpenCodePart): { text: string; toolName: string | null } {
  if (!isRecord(part)) return { text: "", toolName: null };
  const p = part as Record<string, unknown>;
  const type = typeof p["type"] === "string" ? (p["type"] as string) : "";
  switch (type) {
    case "text": {
      const text = typeof p["text"] === "string" ? (p["text"] as string) : "";
      return { text, toolName: null };
    }
    case "file":
      return { text: renderFilePart(p), toolName: null };
    case "tool":
      return renderToolPart(p);
    case "step-start":
    case "step-finish":
      return { text: "", toolName: null };
    default: {
      // Unknown part: keep any text but discard the rest.
      const text = typeof p["text"] === "string" ? (p["text"] as string) : "";
      return { text, toolName: null };
    }
  }
}

interface NormalizedTurn {
  role: Exclude<OpenCodeRole, "system">;
  text: string;
}

function turnFromMessage(msg: Record<string, unknown>): NormalizedTurn | null {
  const role = normalizeRole(msg["role"]);
  if (!role || role === "system") return null;

  const parts = msg["parts"];
  if (!isOpenCodePartArray(parts)) return null;

  const rendered: string[] = [];
  for (const part of parts) {
    const { text } = renderPart(part);
    if (text.trim()) rendered.push(text.trim());
  }
  if (rendered.length === 0) return null;

  return { role, text: rendered.join("\n") };
}

function extractTaskTitle(envelope: Record<string, unknown>): string {
  if (isRecord(envelope["info"])) {
    return extractTopLevelString(envelope["info"] as Record<string, unknown>, ["title", "slug", "description"]);
  }
  return "";
}

export function detectOpenCode(raw: string): boolean {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return false;
  try {
    const obj = JSON.parse(trimmed) as unknown;
    if (!isRecord(obj)) return false;

    // Primary: explicit format declaration.
    if (obj["format"] === "opencode-session-bundle") return true;

    // Secondary: shape heuristic.
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
 * Parse an OpenCode session bundle into the shared shape.
 * Never throws; returns an empty `unknown` shape when nothing is usable.
 */
export function parseOpenCodeSession(raw: string, _filename?: string): ParsedSession {
  const empty = (format: string): ParsedSession => ({
    task: "",
    result: "",
    toolsUsed: [],
    transcript: "",
    turnCount: 0,
    conversationCount: 1,
    format,
    source: "opencode",
  });

  const trimmed = (raw ?? "").trim();
  if (!trimmed) return empty("unknown");

  let envelope: Record<string, unknown>;
  try {
    envelope = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    return empty("opencode-json");
  }
  if (!isRecord(envelope)) return empty("opencode-json");

  const title = extractTaskTitle(envelope);
  const messages = Array.isArray(envelope["messages"]) ? (envelope["messages"] as unknown[]) : [];
  const turns: NormalizedTurn[] = [];
  const tools = new Set<string>();

  for (const m of messages) {
    if (!isRecord(m)) continue;
    const parts = m["parts"];
    if (isOpenCodePartArray(parts)) {
      for (const part of parts) {
        if (isRecord(part) && part["type"] === "tool" && typeof part["tool"] === "string") {
          tools.add(part["tool"] as string);
        }
      }
    }
    const t = turnFromMessage(m);
    if (t) turns.push(t);
  }

  if (turns.length === 0) {
    return empty("opencode-json");
  }

  const firstUser = turns.find((t) => t.role === "user");
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");

  const task = firstUser ? clip(firstUser.text, 4_000) : title || "(no user turn found in session)";
  const result = lastAssistant ? clip(lastAssistant.text, 4_000) : "(no assistant turn found in session)";

  const transcript = turns.map((t) => `### ${t.role.toUpperCase()}\n${clip(t.text, MAX_TURN_CHARS)}`).join("\n\n");

  return {
    task,
    result,
    toolsUsed: [...tools],
    transcript,
    turnCount: turns.length,
    conversationCount: 1,
    format: "opencode-json",
    source: "opencode",
  };
}
