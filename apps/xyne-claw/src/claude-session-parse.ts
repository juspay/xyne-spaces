/**
 * Claude session parser (runs on claw, alongside the curator).
 *
 * Normalizes an uploaded Claude conversation export into the shape the
 * session curator consumes: task / result / toolsUsed / transcript.
 *
 * Two input formats are auto-detected:
 *
 *   1. Claude Code JSONL — one JSON object per line, as written to
 *      ~/.claude/projects/<slug>/<sessionId>.jsonl. Entries look like:
 *        {"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}
 *        {"type":"assistant","message":{"role":"assistant","content":[
 *            {"type":"text","text":"..."},
 *            {"type":"tool_use","name":"Read","input":{...}}]}}
 *        {"type":"user","message":{"role":"user","content":[
 *            {"type":"tool_result","tool_use_id":"...","content":"..."}]}}
 *      Non-turn lines ("summary", "system", file-history snapshots) are ignored.
 *
 *   2. claude.ai JSON export — either a single conversation object
 *        {"name":"...","chat_messages":[{"sender":"human","text":"..."}, ...]}
 *      or an array of such conversations (conversations.json).
 *
 * Everything here is best-effort and defensive: malformed lines / blocks are
 * skipped, never thrown. The output is UNTRUSTED — it only ever reaches the
 * curator, whose proposals sit behind the admin HITL review gate. Nothing in
 * this file retains anything.
 */

export interface ParsedClaudeSession {
  task: string;
  /** Final assistant turn — used as the curator's `result`. */
  result: string;
  toolsUsed: string[];
  /** Ordered, human-readable transcript. May be large; the curator chunks it. */
  transcript: string;
  /** Distinct conversations found (claude.ai array export). */
  conversationCount: number;
  /** Normalized turn count. 0 => parse produced nothing usable. */
  turnCount: number;
  format: "jsonl" | "claude-ai-json" | "unknown";
}

interface NormalizedTurn {
  role: "user" | "assistant" | "tool";
  text: string;
}

const MAX_TOOL_RESULT_CHARS = 2_000;
const MAX_TURN_CHARS = 8_000;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}…[truncated]` : s;
}

// Prefix-matched (NOT exact): real transcripts carry e.g.
// "## Event Type: APP_MENTIONED" — an exact Set lookup would miss them.
const HARNESS_SECTION_HEADINGS = [
  "## Additional Context",
  "## Event Type:",
  "## Thread Awareness",
  "## Current User",
  "## Session Metadata",
];

function isHarnessHeading(line: string): boolean {
  return HARNESS_SECTION_HEADINGS.some((h) => line.startsWith(h));
}

/** Remove agent-harness scaffolding from a normalized turn without touching domain content. */
export function cleanTurnText(text: string): string {
  if (typeof text !== "string" || text.length === 0) return "";

  try {
    const withoutTags = text
      .replace(/<system\b[^>]*>[\s\S]*?<\/system\s*>/gi, "")
      .replace(/<local-command-caveat\b[^>]*>[\s\S]*?<\/local-command-caveat\s*>/gi, "");
    const lines = withoutTags.replace(/\r\n?/g, "\n").split("\n");
    const kept: string[] = [];
    let droppingSection = false;

    for (const line of lines) {
      if (isHarnessHeading(line)) {
        droppingSection = true;
        continue;
      }
      if (droppingSection) {
        if (line.trim() === "") {
          droppingSection = false;
          kept.push(line);
        } else if (line.startsWith("## ")) {
          droppingSection = false;
          kept.push(line);
        }
        continue;
      }
      if (
        line.startsWith("- **Name:**") ||
        line.startsWith("- **Email:**") ||
        line.startsWith("To get your Spaces user ID")
      ) {
        continue;
      }
      kept.push(line);
    }

    return kept.join("\n").replace(/\n{3,}/g, "\n\n");
  } catch {
    return text;
  }
}

/**
 * Flatten a message `content` (string | block[]) into display text plus the
 * names of any tools invoked in it. Handles Anthropic block shapes:
 * text / tool_use / tool_result. Unknown block types contribute nothing.
 */
function flattenContent(content: unknown): { text: string; tools: string[] } {
  const tools: string[] = [];
  const parts: string[] = [];

  if (typeof content === "string") {
    return { text: content, tools };
  }
  if (!Array.isArray(content)) {
    return { text: "", tools };
  }

  for (const block of content) {
    if (typeof block === "string") {
      parts.push(block);
      continue;
    }
    if (!isRecord(block)) continue;
    const type = typeof block["type"] === "string" ? (block["type"] as string) : "";

    if (type === "text" && typeof block["text"] === "string") {
      parts.push(block["text"] as string);
    } else if (type === "tool_use") {
      const name = typeof block["name"] === "string" ? (block["name"] as string) : "(unnamed-tool)";
      tools.push(name);
      const input = block["input"];
      const inputStr = input === undefined ? "" : safeJson(input);
      parts.push(`[tool_use ${name}${inputStr ? ` ${clip(inputStr, 400)}` : ""}]`);
    } else if (type === "tool_result") {
      const inner = block["content"];
      const innerText = typeof inner === "string" ? inner : flattenContent(inner).text;
      const errFlag = block["is_error"] === true ? " ERROR" : "";
      parts.push(`[tool_result${errFlag}] ${clip(innerText, MAX_TOOL_RESULT_CHARS)}`);
    } else if (typeof block["text"] === "string") {
      // Unknown block but carries text — keep the text.
      parts.push(block["text"] as string);
    }
  }

  return { text: parts.join("\n").trim(), tools };
}

function safeJson(v: unknown): string {
  try {
    return typeof v === "string" ? v : JSON.stringify(v);
  } catch {
    return "";
  }
}

/**
 * Pull a role + content out of one JSONL entry. Claude Code wraps the actual
 * message under `.message`; some exports put role/content at top level.
 * Returns null for non-turn lines (summary/system/file snapshots).
 */
function turnFromJsonlEntry(entry: Record<string, unknown>): NormalizedTurn | null {
  const type = typeof entry["type"] === "string" ? (entry["type"] as string) : "";
  if (type === "summary" || type === "system" || type === "file-history-snapshot") return null;

  const message = isRecord(entry["message"]) ? (entry["message"] as Record<string, unknown>) : entry;

  const rawRole =
    (typeof message["role"] === "string" && (message["role"] as string)) ||
    (type === "user" || type === "assistant" ? type : "");
  if (rawRole !== "user" && rawRole !== "assistant") return null;

  const { text, tools } = flattenContent(message["content"]);
  if (!text && tools.length === 0) return null;

  // A user turn that only carries tool_result is really the tool channel.
  const isToolChannel = rawRole === "user" && /^\[tool_result/.test(text) && tools.length === 0;
  return { role: isToolChannel ? "tool" : (rawRole as "user" | "assistant"), text };
}

function tryParseJsonl(raw: string): { turns: NormalizedTurn[]; tools: string[] } | null {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  let parsedAny = false;
  const turns: NormalizedTurn[] = [];
  const tools = new Set<string>();

  for (const line of lines) {
    let obj: unknown;
    try {
      obj = JSON.parse(line);
    } catch {
      // A single un-parseable line does NOT disqualify JSONL — real exports
      // occasionally contain a stray blank/partial line. Skip it.
      continue;
    }
    if (!isRecord(obj)) continue;
    parsedAny = true;
    const t = turnFromJsonlEntry(obj);
    if (t) {
      const { tools: lineTools } = flattenContent(
        isRecord(obj["message"]) ? (obj["message"] as Record<string, unknown>)["content"] : obj["content"],
      );
      lineTools.forEach((x) => tools.add(x));
      turns.push(t);
    }
  }

  if (!parsedAny) return null;
  return { turns, tools: [...tools] };
}

/** Extract turns from one claude.ai conversation object. */
function turnsFromClaudeAiConversation(
  conv: Record<string, unknown>,
): { turns: NormalizedTurn[]; tools: string[] } {
  const turns: NormalizedTurn[] = [];
  const tools = new Set<string>();
  const messages = Array.isArray(conv["chat_messages"])
    ? (conv["chat_messages"] as unknown[])
    : Array.isArray(conv["messages"])
      ? (conv["messages"] as unknown[])
      : [];

  for (const m of messages) {
    if (!isRecord(m)) continue;
    const sender =
      (typeof m["sender"] === "string" && (m["sender"] as string)) ||
      (typeof m["role"] === "string" && (m["role"] as string)) ||
      "";
    const role: "user" | "assistant" | null =
      sender === "human" || sender === "user"
        ? "user"
        : sender === "assistant"
          ? "assistant"
          : null;
    if (!role) continue;

    // Prefer structured `content` blocks; fall back to flat `text`.
    let flattened = flattenContent(m["content"]);
    if (!flattened.text && typeof m["text"] === "string") {
      flattened = { text: m["text"] as string, tools: flattened.tools };
    }
    flattened.tools.forEach((x) => tools.add(x));
    if (!flattened.text) continue;
    turns.push({ role, text: flattened.text });
  }

  return { turns, tools: [...tools] };
}

function tryParseClaudeAiJson(
  raw: string,
): { turns: NormalizedTurn[]; tools: string[]; conversationCount: number } | null {
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  const conversations: Record<string, unknown>[] = [];
  if (Array.isArray(obj)) {
    for (const c of obj) if (isRecord(c)) conversations.push(c);
  } else if (isRecord(obj)) {
    if (Array.isArray(obj["chat_messages"]) || Array.isArray(obj["messages"])) {
      conversations.push(obj);
    } else if (Array.isArray(obj["conversations"])) {
      for (const c of obj["conversations"] as unknown[]) if (isRecord(c)) conversations.push(c);
    }
  }
  if (conversations.length === 0) return null;

  const allTurns: NormalizedTurn[] = [];
  const tools = new Set<string>();
  for (const conv of conversations) {
    const { turns, tools: convTools } = turnsFromClaudeAiConversation(conv);
    allTurns.push(...turns);
    convTools.forEach((x) => tools.add(x));
  }
  if (allTurns.length === 0) return null;
  return { turns: allTurns, tools: [...tools], conversationCount: conversations.length };
}

function renderTranscript(turns: NormalizedTurn[]): string {
  const label: Record<NormalizedTurn["role"], string> = {
    user: "USER",
    assistant: "ASSISTANT",
    tool: "TOOL",
  };
  return turns
    .map((t) => `### ${label[t.role]}\n${clip(t.text, MAX_TURN_CHARS)}`)
    .join("\n\n");
}

/**
 * Parse a raw uploaded Claude session (JSONL or claude.ai JSON) into the
 * curator's input shape. Never throws — returns format:"unknown" with
 * turnCount 0 when nothing usable is found.
 */
export function parseClaudeSession(raw: string, _filename: string): ParsedClaudeSession {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) {
    return { task: "", result: "", toolsUsed: [], transcript: "", conversationCount: 0, turnCount: 0, format: "unknown" };
  }

  // Detection order matters: JSONL first (multiple lines each valid JSON),
  // then whole-file JSON. A claude.ai single-object export is valid JSON but
  // NOT valid line-by-line JSONL, so tryParseJsonl returns turns only when the
  // lines genuinely parse — a one-line JSON file also parses here, so we
  // additionally require that JSONL produced turns before preferring it.
  let format: ParsedClaudeSession["format"] = "unknown";
  let turns: NormalizedTurn[] = [];
  let tools: string[] = [];
  let conversationCount = 1;

  const looksJsonl = trimmed.includes("\n") && /^\s*\{/.test(trimmed);
  if (looksJsonl) {
    const jsonl = tryParseJsonl(trimmed);
    if (jsonl && jsonl.turns.length > 0) {
      format = "jsonl";
      turns = jsonl.turns;
      tools = jsonl.tools;
    }
  }

  if (format === "unknown") {
    const ai = tryParseClaudeAiJson(trimmed);
    if (ai) {
      format = "claude-ai-json";
      turns = ai.turns;
      tools = ai.tools;
      conversationCount = ai.conversationCount;
    }
  }

  // Last resort: if it was JSONL-shaped but the guard above skipped it, retry.
  if (format === "unknown") {
    const jsonl = tryParseJsonl(trimmed);
    if (jsonl && jsonl.turns.length > 0) {
      format = "jsonl";
      turns = jsonl.turns;
      tools = jsonl.tools;
    }
  }

  if (turns.length === 0) {
    return { task: "", result: "", toolsUsed: [], transcript: "", conversationCount: 0, turnCount: 0, format };
  }

  turns = turns
    .map((turn) => ({ ...turn, text: cleanTurnText(turn.text) }))
    .filter((turn) => turn.text.trim().length > 0);

  if (turns.length === 0) {
    return { task: "", result: "", toolsUsed: tools, transcript: "", conversationCount, turnCount: 0, format };
  }

  const firstUser = turns.find((t) => t.role === "user");
  const lastAssistant = [...turns].reverse().find((t) => t.role === "assistant");

  const task = firstUser ? clip(firstUser.text, 4_000) : "(no user turn found in session)";
  const result = lastAssistant ? clip(lastAssistant.text, 4_000) : "(no assistant turn found in session)";

  return {
    task,
    result,
    toolsUsed: tools,
    transcript: renderTranscript(turns),
    conversationCount,
    turnCount: turns.length,
    format,
  };
}

/**
 * Split a large transcript into ordered, ≤maxChars windows on turn ("### ")
 * boundaries so a tool_use / tool_result pair is never cut mid-block. Falls
 * back to a hard char split only when a single turn already exceeds maxChars.
 */
export function chunkTranscript(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return text.length > 0 ? [text] : [];

  // Turn markers written by renderTranscript.
  const segments = text.split(/\n\n(?=### (?:USER|ASSISTANT|TOOL)\n)/);
  const chunks: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim().length > 0) chunks.push(current);
    current = "";
  };

  for (const seg of segments) {
    if (seg.length > maxChars) {
      // Single oversized turn — flush, then hard-split it.
      pushCurrent();
      for (let i = 0; i < seg.length; i += maxChars) {
        chunks.push(seg.slice(i, i + maxChars));
      }
      continue;
    }
    if (current.length + seg.length + 2 > maxChars) {
      pushCurrent();
      current = seg;
    } else {
      current = current ? `${current}\n\n${seg}` : seg;
    }
  }
  pushCurrent();
  return chunks;
}
