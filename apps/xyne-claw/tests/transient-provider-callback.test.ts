import { describe, expect, test } from "vitest";
import { transientProviderCallback } from "../src/transient-provider-callback.js";

describe("transient provider callback status", () => {
  test("structured SDLC-style delivery fails instead of pretending completion", () => {
    expect(transientProviderCallback(true)).toEqual({
      status: "failed",
      error:
        "Model provider stalled or was temporarily unavailable. Retry the run.",
    });
  });

  test("interactive chat keeps its user-visible completion notice", () => {
    expect(transientProviderCallback(false)).toEqual({
      status: "completed",
      result:
        "⚠️ The model provider was temporarily unavailable and your request couldn't be completed. Please try again in a moment.",
    });
  });

  test("a stalled work run reports where it stopped instead of a generic outage", () => {
    expect(
      transientProviderCallback(false, {
        idleMs: 123_800,
        completedToolCount: 85,
        lastTool: { name: "sandbox-run", failed: false },
      }),
    ).toEqual({
      status: "completed",
      result: [
        "⚠️ Work stopped before completion because the model stopped responding for 124 seconds.",
        "85 tool calls completed; the last was `sandbox-run` (succeeded).",
        "Work may remain in the sandbox, but no final verification, commit, push, or PR should be assumed. Retry to continue from the saved conversation.",
      ].join("\n\n"),
    });
  });

  test("includes the last tool failure without dumping its full output", () => {
    expect(
      transientProviderCallback(true, {
        idleMs: 120_001,
        completedToolCount: 4,
        lastTool: {
          name: "sandbox-run",
          failed: true,
          error: "pnpm: command not found\nvery long diagnostics",
        },
      }),
    ).toEqual({
      status: "failed",
      error: [
        "Work stopped before completion because the model stopped responding for 120 seconds.",
        "4 tool calls completed; the last was `sandbox-run` (failed: pnpm: command not found).",
        "No final verification or artifact delivery was recorded. Retry the run to continue from the saved conversation.",
      ].join(" "),
    });
  });
});
