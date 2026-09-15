import { describe, it, expect } from "vitest";
import { buildCapacityRetryFlow } from "./builder.js";

const ctx = {
  agentSlug: "euler-doctor",
  channelId: "chan-1",
  conversationId: "conv-1",
  userId: "user-1",
  retryToken: "tok-abc",
};

describe("buildCapacityRetryFlow", () => {
  it("pending: offers Retry now + Stop, and carries the token for the handlers", () => {
    const flow = buildCapacityRetryFlow("private-large", { ...ctx, phase: "pending" });
    const actionIds = flow.components
      .filter((c) => c.type === "button")
      .map((c) => ((c.props as Record<string, unknown>)["action"] as Record<string, unknown>)["actionId"]);
    expect(actionIds).toEqual(["capacity-retry-now", "capacity-retry-cancel"]);
    expect(flow.data).toMatchObject({ actionType: "capacity-retry", retryToken: "tok-abc", provider: "private-large" });
  });

  it("uses only primitive component types (no dashboard deploy needed)", () => {
    const flow = buildCapacityRetryFlow("m", { ...ctx, phase: "pending" });
    for (const c of flow.components) expect(["text", "button"]).toContain(c.type);
  });

  it("retrying/cancelled phases drop the buttons so a stale card can't re-fire", () => {
    for (const phase of ["retrying", "cancelled"] as const) {
      const flow = buildCapacityRetryFlow("m", { ...ctx, phase });
      expect(flow.components.some((c) => c.type === "button")).toBe(false);
    }
  });

  it("exhausted keeps a single Retry-now button so the user can try again after the cap", () => {
    const flow = buildCapacityRetryFlow("m", { ...ctx, phase: "exhausted" });
    const buttons = flow.components.filter((c) => c.type === "button");
    expect(buttons).toHaveLength(1);
    expect(((buttons[0]!.props as Record<string, unknown>)["action"] as Record<string, unknown>)["actionId"]).toBe("capacity-retry-now");
  });

  it("keeps the screenId stable across phases so the card updates in place", () => {
    const a = buildCapacityRetryFlow("m", { ...ctx, phase: "pending" });
    const b = buildCapacityRetryFlow("m", { ...ctx, phase: "retrying" });
    expect(a.screenId).toBe(b.screenId);
  });
});
