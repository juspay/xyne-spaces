import { describe, it, expect } from "vitest";
import { parseSession } from "../src/session-parsers/index.js";
import { parseOpenCodeSession, detectOpenCode } from "../src/session-parsers/opencode.js";
import { parseCodexSession, detectCodex } from "../src/session-parsers/codex.js";

const openCodeFixture = JSON.stringify({
  format: "opencode-session-bundle",
  version: "1.0",
  info: {
    id: "ses_test_001",
    slug: "test-session",
    title: "Test OpenCode Session",
    directory: "/home/user/project",
  },
  messages: [
    {
      role: "user",
      parentID: "root",
      agent: "user",
      model: "",
      finish: "stop",
      parts: [{ type: "text", text: "Refactor the auth module" }],
    },
    {
      role: "assistant",
      parentID: "ses_test_001",
      agent: "opencode",
      model: "claude-sonnet-4",
      finish: "stop",
      parts: [
        { type: "step-start", label: "plan" },
        { type: "text", text: "I'll refactor the auth module." },
        { type: "file", filename: "src/auth.ts" },
        {
          type: "tool",
          tool: "edit_file",
          input: { path: "src/auth.ts", old: "function login() {}", new: "function login(): User {}" },
          output: "Applied edit.",
        },
        { type: "step-finish", label: "plan" },
      ],
    },
  ],
});

const codexFixture = [
  JSON.stringify({
    type: "session_meta",
    payload: {
      session_id: "codex-ses-1",
      timestamp: "2026-07-31T12:00:00Z",
      cwd: "/home/user/project",
      originator: "codex-tui",
      model_provider: "openai",
      base_instructions: "You are a helpful coding assistant.",
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "developer",
      content: [{ type: "text", text: "You are a helpful coding assistant." }],
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "Add a health endpoint" }],
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [
        { type: "output_text", text: "Adding a /health endpoint." },
        {
          type: "tool_call",
          name: "shell",
          call_id: "call_1",
          arguments: { command: "cat > src/routes/health.ts <<'EOF'\nexport function health() {}\nEOF" },
        },
      ],
    },
  }),
  JSON.stringify({
    type: "response_item",
    payload: {
      type: "message",
      role: "assistant",
      content: [{ type: "tool_output", call_id: "call_1", output: "Wrote src/routes/health.ts" }],
    },
  }),
  JSON.stringify({
    type: "event_msg",
    payload: { type: "task_started" },
  }),
].join("\n");

describe("parseSession dispatcher", () => {
  it("trusts an explicit source parameter", () => {
    const parsed = parseSession(openCodeFixture, { source: "opencode", filename: "session.json" });
    expect(parsed.source).toBe("opencode");
    expect(parsed.format).toBe("opencode-json");
    expect(parsed.turnCount).toBe(2);
  });

  it("sniffs OpenCode when no source is given", () => {
    const parsed = parseSession(openCodeFixture);
    expect(parsed.source).toBe("opencode");
    expect(parsed.task).toBe("Refactor the auth module");
  });

  it("sniffs Codex when no source is given", () => {
    const parsed = parseSession(codexFixture);
    expect(parsed.source).toBe("codex");
    expect(parsed.format).toBe("codex-jsonl");
    expect(parsed.turnCount).toBe(3);
  });

  it("falls back to Claude for unrecognized payloads", () => {
    const parsed = parseSession('{"not_a_known_format": true}', { source: "claude" });
    expect(parsed.source).toBe("claude");
    expect(parsed.turnCount).toBe(0);
  });
});

describe("OpenCode parser", () => {
  it("detects the OpenCode envelope", () => {
    expect(detectOpenCode(openCodeFixture)).toBe(true);
    expect(detectOpenCode('{"foo":"bar"}')).toBe(false);
  });

  it("extracts text, file, and tool parts and skips scaffolding", () => {
    const parsed = parseOpenCodeSession(openCodeFixture, "session.json");
    expect(parsed.source).toBe("opencode");
    expect(parsed.task).toBe("Refactor the auth module");
    expect(parsed.result).toContain("I'll refactor the auth module.");
    expect(parsed.transcript).toContain("### USER");
    expect(parsed.transcript).toContain("### ASSISTANT");
    expect(parsed.transcript).toContain("[file: src/auth.ts]");
    expect(parsed.transcript).toContain("[tool edit_file]");
    expect(parsed.transcript).not.toContain("step-start");
    expect(parsed.transcript).not.toContain("step-finish");
    expect(parsed.toolsUsed).toEqual(["edit_file"]);
  });

  it("falls back to a source-safe unknown shape when JSON is invalid", () => {
    const parsed = parseOpenCodeSession("not json", "bad.json");
    expect(parsed.source).toBe("opencode");
    expect(parsed.turnCount).toBe(0);
  });
});

describe("Codex parser", () => {
  it("detects the Codex rollout header", () => {
    expect(detectCodex(codexFixture)).toBe(true);
    expect(detectCodex('{"foo":"bar"}\n')).toBe(false);
  });

  it("extracts user and assistant turns and skips developer/housekeeping lines", () => {
    const parsed = parseCodexSession(codexFixture, "rollout.jsonl");
    expect(parsed.source).toBe("codex");
    expect(parsed.task).toBe("Add a health endpoint");
    expect(parsed.result).toBe("[tool_output id=call_1] Wrote src/routes/health.ts");
    expect(parsed.transcript).toContain("### USER");
    expect(parsed.transcript).toContain("### ASSISTANT");
    expect(parsed.transcript).not.toContain("You are a helpful coding assistant");
    expect(parsed.transcript).not.toContain("session_meta");
    expect(parsed.transcript).toContain("[tool_call shell");
    expect(parsed.toolsUsed).toEqual(["shell"]);
  });

  it("returns unknown shape when the session_meta header is missing", () => {
    const parsed = parseCodexSession('{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"hi"}]}}');
    expect(parsed.source).toBe("codex");
    expect(parsed.turnCount).toBe(0);
  });
});
