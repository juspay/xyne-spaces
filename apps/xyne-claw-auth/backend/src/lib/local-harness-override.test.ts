import { describe, expect, it } from "vitest";
import { parseLocalHarnessOverride } from "./local-harness-override.js";

describe("parseLocalHarnessOverride", () => {
  it("ignores overrides that are not local-harness", () => {
    expect(parseLocalHarnessOverride(undefined)).toEqual({ pinned: false });
    expect(parseLocalHarnessOverride(null)).toEqual({ pinned: false });
    expect(parseLocalHarnessOverride({ provider: "spaces", model: "gpt" })).toEqual({ pinned: false });
  });

  it.each(["claude-code", "codex-cli"] as const)("accepts local-harness:%s", (provider) => {
    expect(parseLocalHarnessOverride({ provider: "local-harness", model: `local-harness:${provider}` })).toEqual({
      pinned: true,
      provider,
    });
  });

  it.each([
    ["an empty provider", "local-harness:"],
    ["an unknown CLI", "local-harness:foo"],
    ["a bare provider name without the prefix", "claude-code"],
    ["an empty string", ""],
  ])("rejects %s", (_label, model) => {
    const parsed = parseLocalHarnessOverride({ provider: "local-harness", model });
    expect(parsed).toMatchObject({ pinned: true });
    expect("error" in parsed && parsed.error).toMatch(/Unknown local harness provider/);
  });

  it("rejects a missing or non-string model", () => {
    expect(parseLocalHarnessOverride({ provider: "local-harness" })).toHaveProperty("error");
    expect(parseLocalHarnessOverride({ provider: "local-harness", model: 42 })).toHaveProperty("error");
  });
});
