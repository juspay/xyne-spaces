import { test, expect } from "vitest";
import { extractEvidenceDigest, parseVerdict, renderRejection } from "../src/verify-response.js";

// ── extractEvidenceDigest ────────────────────────────────────────────────────

test("extractEvidenceDigest pulls pi-native toolResult text, skips assistant prose", () => {
  // pi's real internal format (verified against prod session dumps): a
  // top-level role:"toolResult" message with toolName + text blocks.
  const messages = [
    { role: "user", content: [{ type: "text", text: "how many open PRs?" }] },
    { role: "assistant", content: [{ type: "thinking", text: "hmm" }, { type: "toolCall", name: "bb", id: "t1" }] },
    { role: "toolResult", toolName: "bb", content: [{ type: "text", text: '{"open_pr_count":27}' }] },
    { role: "assistant", content: [{ type: "text", text: "There are 58 PRs" }] },
  ];
  const digest = extractEvidenceDigest(messages);
  expect(digest).toContain("27");
  expect(digest).toContain("[bb]");
  // assistant text (the thing being verified) must NOT be in the evidence
  expect(digest).not.toContain("58 PRs");
  expect(digest).not.toContain("hmm");
});

test("extractEvidenceDigest skips errored toolResults (not ground truth)", () => {
  const messages = [
    { role: "toolResult", toolName: "bb", isError: true, content: [{ type: "text", text: "ECONNREFUSED 27 times" }] },
    { role: "toolResult", toolName: "bb2", content: [{ type: "text", text: "count=27" }] },
  ];
  const digest = extractEvidenceDigest(messages);
  expect(digest).toContain("count=27");
  expect(digest).not.toContain("ECONNREFUSED");
});

test("extractEvidenceDigest still handles Anthropic wire-format tool_result", () => {
  const messages = [
    { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: "value=1.42" }] }] },
  ];
  expect(extractEvidenceDigest(messages)).toContain("1.42");
});

test("extractEvidenceDigest returns empty for no tool results", () => {
  expect(extractEvidenceDigest([{ role: "assistant", content: [{ type: "text", text: "hi" }] }])).toBe("");
  expect(extractEvidenceDigest(undefined)).toBe("");
  expect(extractEvidenceDigest([])).toBe("");
});

test("extractEvidenceDigest keeps the most recent results under the cap", () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({
    role: "user",
    content: [{ type: "tool_result", name: "t", content: `RESULT_${i}_${"x".repeat(500)}` }],
  }));
  const digest = extractEvidenceDigest(messages, 2000);
  expect(digest.length).toBeLessThanOrEqual(2000);
  // tail kept → last result present, first dropped
  expect(digest).toContain("RESULT_49");
  expect(digest).not.toContain("RESULT_0_");
});

// ── parseVerdict ─────────────────────────────────────────────────────────────

test("parseVerdict: ok=true passes with no errors", () => {
  expect(parseVerdict(JSON.stringify({ ok: true, errors: [] }))).toEqual({ ok: true, errors: [] });
});

test("parseVerdict: ok=false with a concrete error is a rejection", () => {
  const v = parseVerdict(JSON.stringify({ ok: false, errors: [{ claim: "58 PRs", check: "recount", found: "27" }] }));
  expect(v.ok).toBe(false);
  expect(v.errors).toHaveLength(1);
  expect(v.errors[0]).toMatchObject({ claim: "58 PRs", found: "27" });
});

test("parseVerdict: ok=false but empty errors fails OPEN (no loop on ambiguity)", () => {
  expect(parseVerdict(JSON.stringify({ ok: false, errors: [] }))).toEqual({ ok: true, errors: [] });
});

test("parseVerdict: unparseable JSON fails open", () => {
  expect(parseVerdict("not json")).toEqual({ ok: true, errors: [] });
});

test("parseVerdict: caps errors at 5 and stringifies fields", () => {
  const many = Array.from({ length: 9 }, (_, i) => ({ claim: `c${i}`, check: "x", found: `f${i}` }));
  const v = parseVerdict(JSON.stringify({ ok: false, errors: many }));
  expect(v.errors).toHaveLength(5);
});

// ── renderRejection ──────────────────────────────────────────────────────────

test("renderRejection produces a machine-shaped delivery status, not prose", () => {
  const raw = renderRejection([{ claim: "58 PRs", check: "recount", found: "27" }]);
  const parsed = JSON.parse(raw);
  expect(parsed.delivered).toBe(false);
  expect(parsed.errors[0].found).toBe("27");
  expect(parsed.action).toMatch(/submit-response/);
  // no apology-inviting language
  expect(raw.toLowerCase()).not.toMatch(/sorry|apolog/);
});
