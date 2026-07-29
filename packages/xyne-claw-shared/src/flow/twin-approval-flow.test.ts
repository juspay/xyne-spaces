import { describe, it, expect } from "vitest";
import { buildTwinApprovalFlow, type TwinApprovalFlowParams } from "./builder.js";
import { isTwinDelivery } from "../types/twin-delivery.js";
import type { FlowComponent, FlowDefinition } from "./builder.js";

function base(overrides: Partial<TwinApprovalFlowParams> = {}): TwinApprovalFlowParams {
  return {
    delivery: { action: "reply", message: "Sure, on it." },
    sourceMessageId: "msg-trigger",
    targetChannelId: "ch1",
    targetConversationId: "conv1",
    mentionedUserId: "u-me",
    workspaceId: "ws1",
    senderId: "u-sender",
    senderName: "Alice",
    channelName: "engineering",
    task: "can you review the PR?",
    agentSlug: "digital-twin",
    dmChannelId: "dm1",
    spacesBaseUrl: "https://spaces.example.com",
    ...overrides,
  };
}

function walk(components: FlowComponent[]): FlowComponent[] {
  const out: FlowComponent[] = [];
  for (const c of components) {
    out.push(c);
    if (c.children) out.push(...walk(c.children));
  }
  return out;
}
const hasTextarea = (flow: FlowDefinition) => walk(flow.components).some((c) => c.type === "textarea");
const data = (flow: FlowDefinition) => (flow.data ?? {}) as Record<string, unknown>;

describe("isTwinDelivery", () => {
  it("accepts well-formed deliveries", () => {
    expect(isTwinDelivery({ action: "react", emoji: "👍" })).toBe(true);
    expect(isTwinDelivery({ action: "reply", message: "hi" })).toBe(true);
    expect(isTwinDelivery({ action: "react_and_reply", emoji: "✅", message: "done" })).toBe(true);
  });
  it("accepts ignore with no emoji/message (a valid confident-silence delivery)", () => {
    expect(isTwinDelivery({ action: "ignore" })).toBe(true);
    // A stray emoji field must not invalidate an ignore.
    expect(isTwinDelivery({ action: "ignore", emoji: "x" })).toBe(true);
  });
  it("rejects malformed / incomplete deliveries", () => {
    expect(isTwinDelivery(null)).toBe(false);
    expect(isTwinDelivery({ action: "reply" })).toBe(false); // no message
    expect(isTwinDelivery({ action: "react" })).toBe(false); // no emoji
    expect(isTwinDelivery({ action: "react_and_reply", emoji: "👍" })).toBe(false); // no message
    expect(isTwinDelivery({ action: "shout", message: "hi" })).toBe(false);
  });
});

describe("buildTwinApprovalFlow", () => {
  it("reply: shows an editable body, prefills it, and carries the structured delivery in data", () => {
    const flow = buildTwinApprovalFlow(base());
    expect(hasTextarea(flow)).toBe(true);
    expect(flow.state.values["editedContent"]).toBe("Sure, on it.");
    const d = data(flow);
    expect(d["actionType"]).toBe("twin-approval");
    expect(d["deliveryAction"]).toBe("reply");
    expect(d["messageContent"]).toBe("Sure, on it.");
    expect(d["sourceMessageId"]).toBe("msg-trigger");
    expect(d["destinationKind"]).toBe("origin_thread");
    expect(d["targetChannelId"]).toBe("ch1");
    expect(d["targetConversationId"]).toBe("conv1");
    expect(d["senderId"]).toBe("u-sender");
  });

  it("react-only: NO editable body, carries the emoji, no reply text", () => {
    const flow = buildTwinApprovalFlow(base({ delivery: { action: "react", emoji: "🎉" } }));
    expect(hasTextarea(flow)).toBe(false);
    const d = data(flow);
    expect(d["deliveryAction"]).toBe("react");
    expect(d["deliveryEmoji"]).toBe("🎉");
    expect(d["messageContent"]).toBe("");
    expect(flow.state.values["editedContent"]).toBeUndefined();
  });

  it("react_and_reply: editable body AND emoji", () => {
    const flow = buildTwinApprovalFlow(base({ delivery: { action: "react_and_reply", emoji: "👍", message: "yep" } }));
    expect(hasTextarea(flow)).toBe(true);
    const d = data(flow);
    expect(d["deliveryAction"]).toBe("react_and_reply");
    expect(d["deliveryEmoji"]).toBe("👍");
    expect(d["messageContent"]).toBe("yep");
  });

  it("destination override: records the destination + reason and surfaces them in the plan", () => {
    const flow = buildTwinApprovalFlow(base({
      delivery: {
        action: "reply",
        message: "posting in the eng channel",
        destination: { kind: "channel", channelId: "ch-eng", channelName: "engineering" },
        destinationReason: "this is eng-specific",
      },
    }));
    const d = data(flow);
    expect(d["destinationKind"]).toBe("channel");
    expect(d["destinationChannelId"]).toBe("ch-eng");
    expect(d["destinationReason"]).toBe("this is eng-specific");
    // The plan text (a component) should mention the chosen destination + reason.
    const planText = walk(flow.components).map((c) => JSON.stringify(c.props ?? {})).join(" ");
    expect(planText).toContain("engineering");
    expect(planText).toContain("this is eng-specific");
  });

  it("has approve + decline submit actions", () => {
    const flow = buildTwinApprovalFlow(base());
    const actionIds = walk(flow.components)
      .map((c) => (c.props?.["action"] as { actionId?: string } | undefined)?.actionId)
      .filter(Boolean);
    expect(actionIds).toContain("twin-approve");
    expect(actionIds).toContain("twin-decline");
  });
});
