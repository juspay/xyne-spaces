import { describe, expect, it } from "vitest";
import { buildUserDetails } from "../src/agent.js";

describe("buildUserDetails", () => {
  it("gives the model the Spaces user id so it can skip spaces-whoami", () => {
    const text = buildUserDetails("claw-1", "Anurag", "a@juspay.in", { userId: "spaces-9", workspaceId: "ws-1" });
    expect(text).toContain("- **Spaces user ID:** spaces-9");
    expect(text).toContain("- **Spaces workspace ID:** ws-1");
    expect(text).toContain("You do not need to call `spaces-whoami`");
    expect(text).not.toContain("call the `spaces-whoami` tool first");
  });

  it("keeps the whoami instruction when the id is unknown", () => {
    const text = buildUserDetails("claw-1", "Anurag", undefined, { userId: undefined, workspaceId: "ws-1" });
    expect(text).toContain("call the `spaces-whoami` tool first");
    expect(text).not.toContain("**Spaces user ID:**");
  });
});
