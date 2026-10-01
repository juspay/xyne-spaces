import { describe, expect, it } from "vitest";
import { compileGuidanceChain } from "./guidance-chain.js";

describe("compileGuidanceChain", () => {
  it("concatenates org → space → leaf", () => {
    const res = compileGuidanceChain([
      { tier: "org", label: "tenant", body: "Org rules." },
      { tier: "space", label: "eng", body: "Team conventions." },
      { tier: "leaf", label: "auth", body: "Auth path overrides." },
    ]);
    expect(res.truncated).toBe(false);
    expect(res.layersKept).toBe(3);
    expect(res.text).toContain("Org rules.");
    expect(res.text).toContain("Auth path overrides.");
  });

  it("truncates leaf when over budget", () => {
    const res = compileGuidanceChain(
      [
        { tier: "org", label: "tenant", body: "ORG".repeat(20) },
        { tier: "leaf", label: "deep", body: "LEAF".repeat(200) },
      ],
      200,
    );
    expect(res.truncated).toBe(true);
    expect(res.text).toContain("ORG");
    expect(res.layersKept).toBeGreaterThanOrEqual(1);
  });
});
