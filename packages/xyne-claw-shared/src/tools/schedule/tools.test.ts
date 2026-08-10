import { describe, expect, it } from "vitest";

import { carryTaskCommandPrefix } from "./tools.js";

describe("carryTaskCommandPrefix", () => {
  it("prepends the command when the model dropped the prefix", () => {
    expect(
      carryTaskCommandPrefix("Refresh the Claw prod health dashboard", "/dashboard"),
    ).toBe("/dashboard Refresh the Claw prod health dashboard");
  });

  it("does not double-prefix when the task already starts with the command", () => {
    expect(
      carryTaskCommandPrefix("/dashboard errors last 24h", "/dashboard"),
    ).toBe("/dashboard errors last 24h");
  });

  it("treats the bare command (no args) as already prefixed", () => {
    expect(carryTaskCommandPrefix("/dashboard", "/dashboard")).toBe("/dashboard");
  });

  it("matches the prefix case-insensitively and tolerates leading whitespace", () => {
    expect(carryTaskCommandPrefix("  /DASHBOARD errors", "/dashboard")).toBe(
      "  /DASHBOARD errors",
    );
  });

  it("treats a newline right after the command as already prefixed", () => {
    expect(carryTaskCommandPrefix("/dashboard\nerrors", "/dashboard")).toBe(
      "/dashboard\nerrors",
    );
  });

  it("does NOT treat a different command with the same prefix substring as matched", () => {
    // "/dashboards ..." must NOT count as already carrying "/dashboard".
    expect(carryTaskCommandPrefix("/dashboards weekly", "/dashboard")).toBe(
      "/dashboard /dashboards weekly",
    );
  });

  it("returns the task unchanged when the run has no task command", () => {
    expect(carryTaskCommandPrefix("do a thing", undefined)).toBe("do a thing");
  });

  it("ignores a command that is not a slash-command", () => {
    expect(carryTaskCommandPrefix("do a thing", "dashboard")).toBe("do a thing");
  });

  it("works for other slash-commands too", () => {
    expect(carryTaskCommandPrefix("build an explainer", "/explainer")).toBe(
      "/explainer build an explainer",
    );
  });
});
