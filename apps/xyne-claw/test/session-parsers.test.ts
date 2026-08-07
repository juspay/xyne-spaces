/**
 * Fixtures mirror REAL file shapes (verified against actual ~/.codex/sessions
 * rollouts and ~/.local/share/opencode storage), plus the legacy invented
 * shapes the first parser version targeted — kept as back-compat cases.
 */
import { describe, it, expect } from "vitest";
import { parseSession } from "../src/session-parsers/index.js";
import { parseOpenCodeSession, detectOpenCode } from "../src/session-parsers/opencode.js";
import { parseCodexSession, detectCodex } from "../src/session-parsers/codex.js";
import { redactSecrets } from "../src/session-parsers/common.js";

// ── Codex: REAL wrapped rollout shape ────────────────────────────────
const codexRealFixture = [
  JSON.stringify({
    timestamp: "2026-08-04T10:39:34.932Z",
    type: "session_meta",
    payload: { session_id: "0199aaaa", id: "0199aaaa", cwd: "/repo", originator: "codex-tui", cli_version: "0.50.0" },
  }),
  // Scaffolding user messages injected BEFORE the human's prompt:
  JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>\n  <cwd>/repo</cwd>\n</environment_context>" }] },
  }),
  JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<user_instructions>always be terse</user_instructions>" }] },
  }),
  // The actual task:
  JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Add a /health endpoint" }] },
  }),
  JSON.stringify({ type: "event_msg", payload: { type: "task_started" } }),
  JSON.stringify({ type: "response_item", payload: { type: "reasoning", summary: [] } }),
  // Real tool traffic = separate response_item payload types:
  JSON.stringify({
    type: "response_item",
    payload: { type: "function_call", name: "shell", arguments: '{"command":["ls","src/routes"]}', call_id: "call_1" },
  }),
  JSON.stringify({
    type: "response_item",
    payload: { type: "function_call_output", call_id: "call_1", output: "health.ts\nrun.ts" },
  }),
  JSON.stringify({
    type: "response_item",
    payload: { type: "custom_tool_call", name: "apply_patch", input: "*** Begin Patch ***", call_id: "call_2" },
  }),
  JSON.stringify({
    type: "response_item",
    payload: { type: "custom_tool_call_output", call_id: "call_2", output: "Wrote src/routes/health.ts" },
  }),
  // Final assistant answer:
  JSON.stringify({
    type: "response_item",
    payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Added the /health endpoint." }] },
  }),
].join("\n");

// ── Codex: OLD bare (pre-wrapper) rollout shape ──────────────────────
const codexOldFormatFixture = [
  JSON.stringify({ id: "0199bbbb", timestamp: "2025-11-02T10:00:00Z", instructions: "be helpful", cwd: "/repo" }),
  JSON.stringify({ type: "message", role: "user", content: [{ type: "input_text", text: "Fix the failing test" }] }),
  JSON.stringify({ type: "function_call", name: "shell", arguments: '{"command":["pytest"]}', call_id: "c1" }),
  JSON.stringify({ type: "function_call_output", call_id: "c1", output: "1 failed" }),
  JSON.stringify({ type: "message", role: "assistant", content: [{ type: "output_text", text: "Fixed by updating the fixture." }] }),
].join("\n");

// ── OpenCode: REAL export shape (role under info, tool I/O under state) ──
const openCodeRealFixture = JSON.stringify({
  info: { id: "ses_41ad05real", title: "Debug RN logs", version: "0.5.0" },
  messages: [
    {
      info: { id: "msg_1", sessionID: "ses_41ad05real", role: "user", time: { created: 1 } },
      parts: [{ type: "text", text: "Why is the app crashing on launch?" }],
    },
    {
      info: { id: "msg_2", sessionID: "ses_41ad05real", role: "assistant", modelID: "open-large" },
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "hidden reasoning" },
        {
          type: "tool",
          tool: "bash",
          callID: "call_a",
          state: { status: "completed", input: { command: "adb logcat -d" }, output: "FATAL EXCEPTION: main" },
        },
        { type: "text", text: "The crash is an NPE in MainActivity." },
        { type: "step-finish", reason: "stop" },
      ],
    },
  ],
});

// ── Legacy invented fixtures (back-compat) ───────────────────────────
const openCodeLegacyFixture = JSON.stringify({
  format: "opencode-session-bundle",
  info: { id: "ses_test_001", title: "Test OpenCode Session" },
  messages: [
    { role: "user", parts: [{ type: "text", text: "Refactor the auth module" }] },
    {
      role: "assistant",
      parts: [
        { type: "text", text: "I'll refactor the auth module." },
        { type: "tool", tool: "edit_file", input: { path: "src/auth.ts" }, output: "Applied edit." },
      ],
    },
  ],
});

const claudeJsonlFixture = [
  JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text: "Summarize the repo" }] } }),
  JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "It is a monorepo with three apps." }] } }),
].join("\n");

describe("codex parser (real wrapped format)", () => {
  it("detects real rollouts", () => {
    expect(detectCodex(codexRealFixture)).toBe(true);
    expect(detectCodex(openCodeRealFixture)).toBe(false);
    expect(detectCodex(claudeJsonlFixture)).toBe(false);
  });

  it("captures tool traffic from function_call/custom_tool_call payload types", () => {
    const parsed = parseCodexSession(codexRealFixture);
    expect(parsed.toolsUsed).toContain("shell");
    expect(parsed.toolsUsed).toContain("apply_patch");
    expect(parsed.transcript).toContain("[tool_call shell");
    expect(parsed.transcript).toContain("Wrote src/routes/health.ts");
    // Tool traffic renders as TOOL sections, never assistant prose.
    expect(parsed.transcript).toContain("### TOOL");
  });

  it("skips environment/instructions scaffolding so task is the human request", () => {
    const parsed = parseCodexSession(codexRealFixture);
    expect(parsed.task).toBe("Add a /health endpoint");
    expect(parsed.transcript).not.toContain("<environment_context>");
    expect(parsed.transcript).not.toContain("<user_instructions>");
  });

  it("selects the final assistant message as result, never tool output", () => {
    const parsed = parseCodexSession(codexRealFixture);
    expect(parsed.result).toBe("Added the /health endpoint.");
  });

  it("parses old bare-format rollouts (no {type,payload} wrapper)", () => {
    expect(detectCodex(codexOldFormatFixture)).toBe(true);
    const parsed = parseCodexSession(codexOldFormatFixture);
    expect(parsed.turnCount).toBeGreaterThan(0);
    expect(parsed.task).toBe("Fix the failing test");
    expect(parsed.result).toBe("Fixed by updating the fixture.");
    expect(parsed.toolsUsed).toContain("shell");
  });

  it("returns turnCount 0 AND conversationCount 0 for garbage", () => {
    const parsed = parseCodexSession("not json at all");
    expect(parsed.turnCount).toBe(0);
    expect(parsed.conversationCount).toBe(0);
  });
});

describe("opencode parser (real export format)", () => {
  it("detects real exports via the ses_ shape heuristic", () => {
    expect(detectOpenCode(openCodeRealFixture)).toBe(true);
    expect(detectOpenCode(codexRealFixture)).toBe(false);
  });

  it("reads role from message.info and tool I/O from part.state", () => {
    const parsed = parseOpenCodeSession(openCodeRealFixture);
    expect(parsed.turnCount).toBeGreaterThan(0);
    expect(parsed.task).toBe("Why is the app crashing on launch?");
    expect(parsed.result).toBe("The crash is an NPE in MainActivity.");
    expect(parsed.toolsUsed).toContain("bash");
    expect(parsed.transcript).toContain("FATAL EXCEPTION: main");
    expect(parsed.transcript).toContain("### TOOL");
  });

  it("still parses the legacy bundle shape (top-level role, top-level input/output)", () => {
    const parsed = parseOpenCodeSession(openCodeLegacyFixture);
    expect(parsed.turnCount).toBeGreaterThan(0);
    expect(parsed.task).toBe("Refactor the auth module");
    expect(parsed.toolsUsed).toContain("edit_file");
  });

  it("returns empty counts for non-JSON", () => {
    const parsed = parseOpenCodeSession("plain text");
    expect(parsed.turnCount).toBe(0);
    expect(parsed.conversationCount).toBe(0);
  });
});

describe("parseSession dispatch", () => {
  it("routes by detection when no hint is given", () => {
    expect(parseSession(codexRealFixture).source).toBe("codex");
    expect(parseSession(openCodeRealFixture).source).toBe("opencode");
    expect(parseSession(claudeJsonlFixture).source).toBe("claude");
  });

  it("falls back to detection when the hinted parser finds zero turns", () => {
    // User clicked the Codex button but uploaded a Claude JSONL — the upload
    // must not be silently lost.
    const parsed = parseSession(claudeJsonlFixture, { source: "codex" });
    expect(parsed.source).toBe("claude");
    expect(parsed.turnCount).toBeGreaterThan(0);
  });

  it("trusts a correct hint without re-detection", () => {
    const parsed = parseSession(codexRealFixture, { source: "codex" });
    expect(parsed.source).toBe("codex");
    expect(parsed.turnCount).toBeGreaterThan(0);
  });

  it("redacts credential material from every output field", () => {
    const leaky = [
      JSON.stringify({ type: "session_meta", payload: { session_id: "s" } }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "check my env" }] },
      }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "function_call", name: "shell", arguments: '{"command":["cat",".env"]}', call_id: "c1" },
      }),
      JSON.stringify({
        type: "response_item",
        payload: {
          type: "function_call_output",
          call_id: "c1",
          output: "OPENAI_API_KEY=sk-cAbm9ovtKgaZY48N4CvuAbCdEfGh\nAWS_KEY=AKIAIOSFODNN7EXAMPLE\napi_key: supersecretvalue123",
        },
      }),
      JSON.stringify({
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Your env is set up." }] },
      }),
    ].join("\n");
    const parsed = parseSession(leaky);
    expect(parsed.transcript).not.toContain("sk-cAbm9ovtKgaZY48N4CvuAbCdEfGh");
    expect(parsed.transcript).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(parsed.transcript).not.toContain("supersecretvalue123");
    expect(parsed.transcript).toContain("[REDACTED]");
  });
});

describe("redactSecrets", () => {
  it("redacts common key shapes and leaves prose alone", () => {
    const input = "token=abcd1234efgh5678 and Bearer eyJabc but risky-hyphen-words stay";
    const out = redactSecrets(input);
    expect(out).toContain("token=[REDACTED]");
    expect(out).toContain("risky-hyphen-words stay");
  });
});
