import { describe, it, expect } from "vitest";
import { buildTwinDeliverTool, TWIN_DELIVER_TOOL_NAME, recoverTwinDeliveryFromText, type TwinDeliverRef } from "../src/twin-deliver.js";

const TWIN = "digital-twin";

// The tool's execute() returns { content, details }. A rejection sets
// details.error=true and leaves ref.value undefined; an accept sets ref.value.
async function call(
  agentSlug: string,
  params: unknown,
): Promise<{ ref: TwinDeliverRef; details: Record<string, unknown> }> {
  const ref: TwinDeliverRef = {};
  const tool = buildTwinDeliverTool(agentSlug, ref);
  const res = (await tool.execute("call-1", params)) as { details: Record<string, unknown> };
  return { ref, details: res.details ?? {} };
}

describe("twin_deliver tool", () => {
  it("is named twin_deliver and exposes the destination + id fields", () => {
    const tool = buildTwinDeliverTool(TWIN, {});
    expect(tool.name).toBe(TWIN_DELIVER_TOOL_NAME);
    const props = (tool.parameters as { properties: Record<string, { enum?: string[] }> }).properties;
    // Semantic destination kinds — the Twin fills the ids itself via its Spaces tools.
    expect(props["destination"]!.enum).toEqual(["origin_thread", "origin_channel", "dm_sender", "dm", "channel", "thread"]);
    expect(props["action"]!.enum).toEqual(["react", "reply", "react_and_reply", "ignore"]);
    // Explicit id fields exist (no candidate enum).
    expect(props["dm_user_id"]).toBeDefined();
    expect(props["destination_channel_id"]).toBeDefined();
    expect(props["destination_conversation_id"]).toBeDefined();
  });

  it("accepts action=ignore with no emoji/message — a confident stay-silent", async () => {
    const { ref, details } = await call(TWIN, { action: "ignore" });
    expect(details["error"]).toBeUndefined();
    expect(details["action"]).toBe("ignore");
    expect(ref.value).toEqual({ action: "ignore" });
    expect(ref.value?.emoji).toBeUndefined();
    expect(ref.value?.message).toBeUndefined();
  });

  // Every row must be rejected: details.error=true, nothing delivered, exactly one rejection.
  it.each<[string, string, unknown]>([
    ["is hard-gated to the Digital Twin agent", "some-other-agent", { action: "reply", message: "hi" }],
    ["rejects an unknown action", TWIN, { action: "shout", message: "hi" }],
    ["requires an emoji for react", TWIN, { action: "react" }],
    ["rejects a non-string emoji", TWIN, { action: "react", emoji: 1 }],
    ["requires a message for reply", TWIN, { action: "reply", message: "   " }],
    ["rejects destination=channel with NO destination_channel_id", TWIN, { action: "reply", message: "x", destination: "channel" }],
    ["rejects destination=thread missing the conversation id", TWIN, { action: "reply", message: "x", destination: "thread", destination_channel_id: "ch_eng" }],
    ["rejects destination=dm with NO dm_user_id (use dm_sender instead)", TWIN, { action: "reply", message: "x", destination: "dm" }],
  ])("%s", async (_title, agentSlug, params) => {
    const { ref, details } = await call(agentSlug, params);
    expect(details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
    expect(ref.rejections).toBe(1);
  });

  // Every row must be accepted with exactly this delivery (strict toEqual: no stray keys).
  it.each<[string, unknown, unknown]>([
    ["accepts a react-only delivery (no message)", { action: "react", emoji: "👍" }, { action: "react", emoji: "👍" }],
    // origin_thread is the default, so destination is left out (not serialized).
    [
      "accepts a reply and defaults the destination to origin_thread (omitted)",
      { action: "reply", message: "On it — shipping today." },
      { action: "reply", message: "On it — shipping today." },
    ],
    [
      "accepts react_and_reply with both",
      { action: "react_and_reply", emoji: "✅", message: "done" },
      { action: "react_and_reply", emoji: "✅", message: "done" },
    ],
    [
      "resolves a channel destination from the explicit destination_channel_id",
      { action: "reply", message: "posting here", destination: "channel", destination_channel_id: "ch_eng", destination_reason: "eng-specific" },
      { action: "reply", message: "posting here", destination: { kind: "channel", channelId: "ch_eng" }, destinationReason: "eng-specific" },
    ],
    [
      "resolves a thread destination from channel + conversation ids",
      {
        action: "reply",
        message: "in the live thread",
        destination: "thread",
        destination_channel_id: "ch_eng",
        destination_conversation_id: "conv_123",
        destination_reason: "active thread",
      },
      {
        action: "reply",
        message: "in the live thread",
        destination: { kind: "thread", channelId: "ch_eng", conversationId: "conv_123" },
        destinationReason: "active thread",
      },
    ],
    [
      "dm_sender needs no id — DMs whoever mentioned the user",
      { action: "reply", message: "pinging you 1:1", destination: "dm_sender" },
      { action: "reply", message: "pinging you 1:1", destination: { kind: "dm_sender" } },
    ],
    [
      "dm to ANYONE via dm_user_id (not just the sender)",
      { action: "reply", message: "looping you in", destination: "dm", dm_user_id: "user_abc", destination_reason: "the real owner" },
      { action: "reply", message: "looping you in", destination: { kind: "dm", userId: "user_abc" }, destinationReason: "the real owner" },
    ],
    [
      "ignores destination for a react-only action",
      { action: "react", emoji: "🎉", destination: "origin_channel" },
      { action: "react", emoji: "🎉" },
    ],
  ])("%s", async (_title, params, expected) => {
    const { ref, details } = await call(TWIN, params);
    expect(details["error"]).toBeUndefined();
    expect(ref.value).toEqual(expected);
  });

  it("captures private reasoning with clf- citation tokens verbatim (Why panel); message stays clean", async () => {
    const { ref } = await call(TWIN, {
      action: "reply",
      message: "shipping ask-ai v2 this week, defaulting to glm-latest",
      reasoning: "aman asked and you own it [clf-abc123#2]; v2 parity ships this week [clf-def456#1]",
    });
    expect(ref.value?.reasoning).toBe("aman asked and you own it [clf-abc123#2]; v2 parity ships this week [clf-def456#1]");
    // the POSTED message is never citation-polluted.
    expect(ref.value?.message).not.toContain("clf-");
  });

  it("captures reasoning on react_and_reply and on a react-only delivery", async () => {
    const { ref: r1 } = await call(TWIN, { action: "react_and_reply", emoji: "✅", message: "done", reasoning: "already handled in [clf-x#1]" });
    expect(r1.value?.reasoning).toBe("already handled in [clf-x#1]");
    const { ref: r2 } = await call(TWIN, { action: "react", emoji: "👍", reasoning: "acknowledging, nothing to add [clf-y#3]" });
    expect(r2.value?.reasoning).toBe("acknowledging, nothing to add [clf-y#3]");
  });

  it("keeps reasoning optional — omitted when not given", async () => {
    const { ref } = await call(TWIN, { action: "reply", message: "on it" });
    expect(ref.value?.reasoning).toBeUndefined();
    expect(ref.value).toEqual({ action: "reply", message: "on it" });
  });

  it("never attaches reasoning to an ignore (nothing posted, nothing to explain)", async () => {
    const { ref } = await call(TWIN, { action: "ignore", reasoning: "some private note" });
    expect(ref.value).toEqual({ action: "ignore" });
    expect(ref.value?.reasoning).toBeUndefined();
  });

  it("is idempotent — a second call is a no-op and the first delivery stands (glm re-emit guard)", async () => {
    const ref: TwinDeliverRef = {};
    const tool = buildTwinDeliverTool(TWIN, ref);
    const first = (await tool.execute("call-1", { action: "reply", message: "On it." })) as {
      details: Record<string, unknown>;
    };
    expect(first.details["error"]).toBeUndefined();
    expect(ref.value).toEqual({ action: "reply", message: "On it." });

    // glm re-emits the call (even with DIFFERENT args) — must NOT overwrite.
    const second = (await tool.execute("call-2", { action: "reply", message: "Actually, changed my mind." })) as {
      details: Record<string, unknown>;
      content: Array<{ text: string }>;
    };
    expect(second.details["duplicate"]).toBe(true);
    expect(second.details["error"]).toBeUndefined();
    expect(ref.value).toEqual({ action: "reply", message: "On it." }); // unchanged — first stands
    expect(ref.duplicates).toBe(1);
    expect(second.content[0]?.text).toMatch(/ALREADY delivered/i);

    // a third repeat keeps counting and still doesn't mutate the delivery.
    await tool.execute("call-3", { action: "react", emoji: "👍" });
    expect(ref.value).toEqual({ action: "reply", message: "On it." });
    expect(ref.duplicates).toBe(2);
  });

  it("does NOT trip the idempotency guard after a rejection — the model can still retry", async () => {
    const ref: TwinDeliverRef = {};
    const tool = buildTwinDeliverTool(TWIN, ref);
    // First call is rejected (reply with no message) → ref.value stays undefined.
    const rejected = (await tool.execute("call-1", { action: "reply" })) as { details: Record<string, unknown> };
    expect(rejected.details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
    // Retry with a valid message must succeed (not blocked as a duplicate).
    const retry = (await tool.execute("call-2", { action: "reply", message: "Now valid." })) as {
      details: Record<string, unknown>;
    };
    expect(retry.details["error"]).toBeUndefined();
    expect(retry.details["duplicate"]).toBeUndefined();
    expect(ref.value).toEqual({ action: "reply", message: "Now valid." });
  });
});

describe("recoverTwinDeliveryFromText (glm leaked tool-call recovery)", () => {
  it("recovers GLM <arg_key>/<arg_value> markup (the real failing case)", () => {
    const leaked =
      "<tool_call>twin_deliver<arg_key>action</arg_key><arg_value>reply</arg_value>" +
      "<arg_key>message</arg_key><arg_value>debugging 503 errors on /askai/v2/conversations with prajwal. " +
      "decided to reuse dashboard api instead of separate ones.</arg_value></tool_call>";
    const d = recoverTwinDeliveryFromText(leaked);
    expect(d).not.toBeNull();
    expect(d!.action).toBe("reply");
    expect(d!.message).toContain("503 errors");
    expect(d!.emoji).toBeUndefined();
  });

  it("recovers function-call syntax twin_deliver(action=\"reply\", message=\"...\")", () => {
    const leaked = 'twin_deliver(action="reply", message="on it, will ping in 10")';
    const d = recoverTwinDeliveryFromText(leaked);
    expect(d).toEqual({ action: "reply", message: "on it, will ping in 10" });
  });

  it("recovers a JSON arg blob", () => {
    const leaked = 'calling twin_deliver {"action":"react","emoji":"👍"}';
    const d = recoverTwinDeliveryFromText(leaked);
    expect(d).toEqual({ action: "react", emoji: "👍" });
  });

  it("recovers react_and_reply with both fields (markup)", () => {
    const leaked =
      "<arg_key>action</arg_key><arg_value>react_and_reply</arg_value>" +
      "<arg_key>emoji</arg_key><arg_value>✅</arg_value>" +
      "<arg_key>message</arg_key><arg_value>done</arg_value> (via twin_deliver)";
    const d = recoverTwinDeliveryFromText(leaked);
    expect(d).toEqual({ action: "react_and_reply", emoji: "✅", message: "done" });
  });

  it("recovers an ignore", () => {
    expect(recoverTwinDeliveryFromText('twin_deliver(action="ignore")')).toEqual({ action: "ignore" });
  });

  it("recovers the private reasoning alongside a leaked delivery (markup)", () => {
    const leaked =
      "<tool_call>twin_deliver<arg_key>action</arg_key><arg_value>reply</arg_value>" +
      "<arg_key>message</arg_key><arg_value>on it, shipping this week</arg_value>" +
      "<arg_key>reasoning</arg_key><arg_value>you own ask-ai and it ships v2 this week [clf-abc#1]</arg_value></tool_call>";
    const d = recoverTwinDeliveryFromText(leaked);
    expect(d?.action).toBe("reply");
    expect(d?.message).toBe("on it, shipping this week");
    expect(d?.reasoning).toBe("you own ask-ai and it ships v2 this week [clf-abc#1]");
  });

  it("drops an invalid leaked destination AND its destination_reason — still delivers to the origin thread", () => {
    const leaked = 'twin_deliver(action="reply", message="x", destination="channel", destination_reason="why")';
    expect(recoverTwinDeliveryFromText(leaked)).toEqual({ action: "reply", message: "x" });
  });

  it("keeps a valid leaked destination (dm + dm_user_id)", () => {
    const leaked = 'twin_deliver(action="reply", message="x", destination="dm", dm_user_id="u1")';
    expect(recoverTwinDeliveryFromText(leaked)).toEqual({ action: "reply", message: "x", destination: { kind: "dm", userId: "u1" } });
  });

  it("String()-coerces JSON arg values (unlike the tool, which rejects a non-string emoji)", () => {
    expect(recoverTwinDeliveryFromText('twin_deliver {"action":"react","emoji":1}')).toEqual({ action: "react", emoji: "1" });
  });

  it("keeps the args copied so far when a JSON value can't be String()-coerced", () => {
    const leaked = 'twin_deliver {"action":"reply","message":"on it","x":{"toString":1}}';
    expect(recoverTwinDeliveryFromText(leaked)).toEqual({ action: "reply", message: "on it" });
  });

  it("returns null when there is no twin_deliver call in the text", () => {
    expect(recoverTwinDeliveryFromText("just a normal answer with no tool call")).toBeNull();
    expect(recoverTwinDeliveryFromText('twin_deliver(action="reply")')).toBeNull(); // reply needs a message
    expect(recoverTwinDeliveryFromText("")).toBeNull();
  });
});
