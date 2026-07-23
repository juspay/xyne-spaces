import { test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  promoteIfOversized,
  stripControlChars,
  lineifyForSpill,
  TOOL_RESULT_INLINE_CAP_BYTES,
  SPILL_MAX_LINE_CHARS,
} from "../src/tool-output.js";

const NUL = String.fromCharCode(0);

let dir: string;
beforeAll(async () => { dir = await mkdtemp(join(tmpdir(), "tooltest-")); });
afterAll(async () => { await rm(dir, { recursive: true, force: true }); });

test("stripControlChars removes NUL + C0 controls but keeps tab/newline/cr", () => {
  const input = `a${NUL}bc\td\ne\rf`;
  expect(stripControlChars(input)).toBe("abc\td\ne\rf");
});

test("small output passes through unchanged (minus control bytes)", async () => {
  const out = await promoteIfOversized(dir, "custom", "grep", "hello world");
  expect(out).toBe("hello world");
});

test("oversized single-line output spills, is wrapped, and is byte-preserving", async () => {
  // A pathological single physical line (no newlines) far over the cap.
  const big = "X".repeat(TOOL_RESULT_INLINE_CAP_BYTES + 5000);
  const out = await promoteIfOversized(dir, "custom", "sandbox-run", big);
  // Inline result is a preview + path, NOT the full payload.
  expect(out.length).toBeLessThan(big.length);
  expect(out).toContain("full result saved to");
  expect(out).toContain(".context/tool-results/");
  expect(out).toContain("## Preview");
  // The file exists.
  const files = await readdir(join(dir, ".context", "tool-results"));
  expect(files.length).toBe(1);
  const saved = await readFile(join(dir, ".context", "tool-results", files[0]!), "utf8");
  // Now line-structured: >1 line and NO line exceeds the wrap width.
  const lines = saved.split("\n");
  expect(lines.length).toBeGreaterThan(1);
  expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(SPILL_MAX_LINE_CHARS);
  // Byte-preserving: removing the inserted newlines recovers the original.
  expect(saved.replace(/\n/g, "")).toBe(big);
});

test("NUL bytes are stripped before spill (jsonb-safe)", async () => {
  // Post-strip length must EXCEED the cap to trigger a spill: each "A\0" is 2
  // chars but collapses to 1 after NUL removal.
  const big = `A${NUL}`.repeat(TOOL_RESULT_INLINE_CAP_BYTES + 1000); // full of NULs
  const out = await promoteIfOversized(dir, "custom", "nul-tool", big);
  expect(out).not.toContain(NUL);
  const files = (await readdir(join(dir, ".context", "tool-results"))).filter((f) => f.includes("nul-tool"));
  const saved = await readFile(join(dir, ".context", "tool-results", files[0]!), "utf8");
  expect(saved).not.toContain(NUL);
});

test("disk-write failure falls back to inline truncation (no throw)", async () => {
  const big = "Y".repeat(TOOL_RESULT_INLINE_CAP_BYTES + 1000);
  // A workspace path under an existing *file* can't be mkdir'd → write fails.
  const badWorkspace = join(dir, "grep", "_a_file_as_dir");
  const out = await promoteIfOversized(badWorkspace, "custom", "x", big);
  expect(typeof out).toBe("string");
  expect(out.length).toBeGreaterThan(0);
});

// ── lineifyForSpill (F1) ──────────────────────────────────────────────────

test("lineify: short/already-multiline content is returned unchanged (idempotent)", () => {
  const already = "line one\nline two\nline three";
  expect(lineifyForSpill(already)).toBe(already);
  expect(lineifyForSpill("small")).toBe("small");
});

test("lineify: minified JSON array becomes JSON-Lines (one record per line)", () => {
  // Build a JSON array whose minified form is a single line well over the wrap width.
  const records = Array.from({ length: 2000 }, (_, i) => ({
    merchant_id: i % 2 === 0 ? "meesho" : "jiosaavn",
    bank: "HDFC Bank",
    idx: i,
  }));
  const minified = JSON.stringify(records);
  expect(minified.includes("\n")).toBe(false); // truly single-line input
  expect(minified.length).toBeGreaterThan(SPILL_MAX_LINE_CHARS);

  const lined = lineifyForSpill(minified);
  const lines = lined.split("\n");
  // One line per record.
  expect(lines.length).toBe(records.length);
  // Every line is independently valid JSON → the model can page + parse.
  const first = JSON.parse(lines[0]!);
  expect(first.merchant_id).toBe("meesho");
  // grep-by-dimension works: count meesho rows by line matching.
  const meeshoLines = lines.filter((l) => l.includes('"merchant_id":"meesho"'));
  expect(meeshoLines.length).toBe(1000);
  // No line exceeds the wrap width.
  expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(SPILL_MAX_LINE_CHARS);
});

test("lineify: minified JSON object becomes pretty-printed multi-line", () => {
  const obj: Record<string, number> = {};
  for (let i = 0; i < 1000; i++) obj[`key_${i}`] = i;
  const minified = JSON.stringify(obj);
  expect(minified.includes("\n")).toBe(false);
  expect(minified.length).toBeGreaterThan(SPILL_MAX_LINE_CHARS);

  const lined = lineifyForSpill(minified);
  expect(lined.split("\n").length).toBeGreaterThan(1);
  // Still the same data.
  expect(JSON.parse(lined)).toEqual(obj);
});

test("lineify: non-JSON long line is hard-wrapped, byte-preserving", () => {
  const oneLine = "Z".repeat(SPILL_MAX_LINE_CHARS * 3 + 17);
  const lined = lineifyForSpill(oneLine);
  const lines = lined.split("\n");
  expect(lines.length).toBeGreaterThan(1);
  expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(SPILL_MAX_LINE_CHARS);
  expect(lined.replace(/\n/g, "")).toBe(oneLine);
});

test("lineify: malformed JSON (bracket but unparseable) falls back to hard-wrap, never throws", () => {
  const broken = "[" + "q".repeat(SPILL_MAX_LINE_CHARS * 2); // starts with [ but not valid JSON
  const lined = lineifyForSpill(broken);
  const lines = lined.split("\n");
  expect(lines.length).toBeGreaterThan(1);
  expect(Math.max(...lines.map((l) => l.length))).toBeLessThanOrEqual(SPILL_MAX_LINE_CHARS);
  expect(lined.replace(/\n/g, "")).toBe(broken);
});
