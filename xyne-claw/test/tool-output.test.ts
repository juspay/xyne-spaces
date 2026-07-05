import { test, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promoteIfOversized, stripControlChars, TOOL_RESULT_INLINE_CAP_BYTES } from "../src/tool-output.js";

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

test("oversized output spills to a .context/tool-results file with preview + path", async () => {
  const big = "X".repeat(TOOL_RESULT_INLINE_CAP_BYTES + 5000);
  const out = await promoteIfOversized(dir, "custom", "sandbox-run", big);
  // Inline result is a preview + path, NOT the full payload.
  expect(out.length).toBeLessThan(big.length);
  expect(out).toContain("full result saved to .context/tool-results/");
  expect(out).toContain("## Preview");
  // The file actually exists and holds the full content.
  const files = await readdir(join(dir, ".context", "tool-results"));
  expect(files.length).toBe(1);
  const saved = await readFile(join(dir, ".context", "tool-results", files[0]!), "utf8");
  expect(saved.length).toBe(big.length);
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
