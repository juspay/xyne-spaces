import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Structural guards for the Spaces progress pill.
 *
 * The stuck-spinner bug (prod 2026-09-28) was not a logic error inside one
 * function — it was a MISSING CALL on a code path nobody had connected. Unit
 * tests cannot catch that: the code they would exercise does not exist. So
 * these assert over the source, the same technique
 * queue/run-recovery-experiment.test.ts uses for its dispatch-payload spread.
 *
 * Each `it` pins one invariant that, if broken, reproduces the original bug.
 */

const SRC = join(__dirname, "..");
const webhook = readFileSync(join(SRC, "routes/webhook.ts"), "utf8");

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".ts") && !entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

describe("agentProgress emits are funnelled through one module", () => {
  it("has no direct /chat/agentProgress call outside surfaces/spaces/agent-progress.ts", () => {
    // Every open-coded emit is a chance to forget sessionId — which is exactly
    // how all five original call sites came to omit it, silently disabling
    // Spaces-side straggler suppression.
    const offenders = walk(SRC)
      .filter((file) => !file.endsWith(join("surfaces", "spaces", "agent-progress.ts")))
      .filter((file) => readFileSync(file, "utf8").includes('"/chat/agentProgress"'))
      .map((file) => file.slice(SRC.length + 1));

    expect(offenders).toEqual([]);
  });

  it("requires sessionId on the progress target type", () => {
    const mod = readFileSync(join(SRC, "surfaces/spaces/agent-progress.ts"), "utf8");
    // Optional (`sessionId?:`) would let every existing caller compile while
    // quietly reopening the hole.
    expect(mod).toMatch(/interface AgentProgressTarget\s*\{[^}]*\bsessionId:\s*string;/s);
    expect(mod).not.toMatch(/\bsessionId\?:/);
  });
});

describe("every terminal path in /webhook/result clears the pill", () => {
  const resultHandler = (() => {
    const start = webhook.indexOf("const recoveryCallbackDisposition");
    const end = webhook.indexOf("// Persist the assistant response as a ChatMessage");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    return webhook.slice(start, end);
  })();

  it("clears on the recovery 'stale' early return — the /stop path", () => {
    // A /stop-cancelled run reaches here: reconcileStoppedRuns kills recovery
    // first, so the run's own terminal callback classifies as stale. Returning
    // without clearing is what left the spinner up in the bug report.
    const staleBranch = resultHandler.slice(
      resultHandler.indexOf('=== "stale"'),
      resultHandler.indexOf('=== "stale"') + 900,
    );
    expect(staleBranch).toContain("clearSpacesAgentProgress");
    expect(staleBranch.indexOf("clearSpacesAgentProgress")).toBeLessThan(
      staleBranch.indexOf("return;"),
    );
  });

  it("clears on the non-completed early return — failed and cancelled runs", () => {
    const branch = resultHandler.slice(
      resultHandler.indexOf('payload.status !== "completed"'),
      resultHandler.indexOf('payload.status !== "completed"') + 700,
    );
    expect(branch).toContain("clearSpacesAgentProgress");
  });

  it("still clears on the completed path", () => {
    expect(webhook).toMatch(/USE_EPHEMERAL_PROGRESS\)\s*\{\s*void clearSpacesAgentProgress/);
  });

  it("clears at the source when /stop cancels a run", () => {
    // Belt-and-braces: a cancel can kill the run before it posts back at all,
    // so the stop path must not depend on a terminal callback arriving.
    const reconcile = webhook.slice(
      webhook.indexOf("async function reconcileStoppedRuns"),
      webhook.indexOf("// ── Mid-run message queue helpers"),
    );
    expect(reconcile).toContain("clearSpacesAgentProgress");
  });
});

describe("notice copy", () => {
  /**
   * Pictographic emoji only. Text glyphs that carry structure rather than
   * decoration — ✓ ✗ ☑ ☐ ★ in tables and checklists — are deliberately in
   * scope for keeping: they are typography, not tone.
   */
  const PICTOGRAPHIC = /["`]\s*[\u{1F300}-\u{1FAFF}]/u;

  /**
   * Emoji as DATA, not as voice. These do not write emoji INTO a sentence —
   * the emoji IS the payload (the reaction the bot adds to a message, or a
   * rendering of the reactions users left), so stripping them would delete a
   * feature rather than tidy a string.
   */
  const EMOJI_IS_DATA = [
    "mcp/servers/xyne-spaces-tools.ts", // renders users' reactions back as text
    "surfaces/messaging/ack.ts",        // the ack reaction chosen per message
    "surfaces/messaging/const.ts",      // the default ack reaction
  ];

  /** The same emoji written as an escape — `"\u{1F6D1} Stopped"` — renders
   *  identically, so the guard has to read both spellings. */
  const ESCAPED = /["`]\s*\\u\{1F[0-9A-Fa-f]{3}\}/;

  it("opens no thread message with a decorative emoji", () => {
    const offenders = walk(SRC)
      .map((file) => file.slice(SRC.length + 1))
      .filter((rel) => !EMOJI_IS_DATA.includes(rel))
      .filter((rel) => {
        const body = readFileSync(join(SRC, rel), "utf8");
        return PICTOGRAPHIC.test(body) || ESCAPED.test(body);
      });

    expect(offenders).toEqual([]);
  });

  it("catches an emoji written as an escape sequence", () => {
    expect(ESCAPED.test('notice("\\u{1F6D1} Stopped.")')).toBe(true);
    expect(ESCAPED.test('notice("Stopped.")')).toBe(false);
  });

  it("still allows structural text glyphs", () => {
    // Guards the guard: if someone widens the pattern to all symbols, the
    // status tables and checklists lose their marks.
    expect(PICTOGRAPHIC.test('"✓ done"')).toBe(false);
    expect(PICTOGRAPHIC.test('"☑ item"')).toBe(false);
    expect(PICTOGRAPHIC.test('"★ rating"')).toBe(false);
    expect(PICTOGRAPHIC.test('"🛑 Stopped"')).toBe(true);
    expect(PICTOGRAPHIC.test('"🖥️ Live preview"')).toBe(true);
  });
});
