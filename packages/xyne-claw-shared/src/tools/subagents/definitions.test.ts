import { describe, expect, it } from "vitest";
import { hasDirectSpacesTool } from "./definitions.js";

describe("hasDirectSpacesTool", () => {
  it.each([
    "xyne-spaces__spaces-search",
    "Xyne_Spaces__spaces-create-ticket",
    "Xyne Spaces__user-send-message",
    "spaces-search",
    "spaces-create-ticket",
  ])("recognizes a direct Spaces selection: %s", (selection) => {
    expect(hasDirectSpacesTool({ direct: [selection] })).toBe(true);
  });

  it.each([
    undefined,
    {},
    { direct: [] },
    { direct: ["github__search-code"] },
    { direct: ["knowledge-base__kb-search"] },
    { direct: ["my-spaces-tool"] },
  ])("does not classify non-Spaces selections: %j", (config) => {
    expect(hasDirectSpacesTool(config)).toBe(false);
  });
});
