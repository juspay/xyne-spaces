import { describe, expect, it } from "vitest";
import { decideShellPolicy, splitShellCommand } from "./shell-policy.js";

describe("splitShellCommand", () => {
  it("splits && chains", () => {
    const res = splitShellCommand("git add . && npm test");
    expect(res.splittable).toBe(true);
    if (!res.splittable) return;
    expect(res.commands).toEqual(["git add .", "npm test"]);
  });

  it("marks substitution as unsplittable", () => {
    const res = splitShellCommand("echo $(whoami)");
    expect(res.splittable).toBe(false);
  });
});

describe("decideShellPolicy", () => {
  it("forbidden beats allow across segments", () => {
    const res = decideShellPolicy("ls && rm -rf /", (seg) =>
      /\brm\s+-rf\b/.test(seg) ? "forbidden" : "allow",
    );
    expect(res.decision).toBe("forbidden");
  });
});
