import { describe, expect, it } from "vitest";
import { configForClone } from "./agentRepository.js";

describe("configForClone", () => {
  it("drops the face the source was built with, so the clone gets its own", () => {
    expect(configForClone({ avatarKey: "draft_9", permissionMode: "ask", tools: { direct: ["x"] } })).toEqual({
      permissionMode: "ask",
      tools: { direct: ["x"] },
    });
  });

  it("leaves anything that isn't a config object alone", () => {
    expect(configForClone(null)).toBeNull();
    expect(configForClone([1])).toEqual([1]);
  });
});
