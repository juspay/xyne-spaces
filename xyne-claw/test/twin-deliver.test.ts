import { describe, it, expect } from "vitest";
import { buildTwinDeliverTool, buildTwinDeliverMandate, TWIN_DELIVER_TOOL_NAME, recoverTwinDeliveryFromText, type TwinDeliverRef } from "../src/twin-deliver.js";

const TWIN = "digital-twin";

// The tool's execute() returns { content, details }. A rejection sets
// details.error=true and leaves ref.value undefined; an accept sets ref.value.
async function call(
  agentSlug: string,
  params: unknown,
): Promise<{ ref: TwinDeliverRef; details: Record<string, unknown>; text: string }> {
  const ref: TwinDeliverRef = {};
  const tool = buildTwinDeliverTool(agentSlug, ref);
  const res = (await tool.execute("call-1", params)) as {
    content: Array<{ text: string }>;
    details: Record<string, unknown>;
  };
  return { ref, details: res.details ?? {}, text: res.content?.[0]?.text ?? "" };
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

  it("is hard-gated to the Digital Twin agent", async () => {
    const { ref, details } = await call("some-other-agent", { action: "reply", message: "hi" });
    expect(details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
  });

  it("rejects an unknown action", async () => {
    const { ref, details } = await call(TWIN, { action: "shout", message: "hi" });
    expect(details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
  });

  it("requires an emoji for react", async () => {
    const { ref, details } = await call(TWIN, { action: "react" });
    expect(details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
  });

  it("requires a message for reply", async () => {
    const { ref, details } = await call(TWIN, { action: "reply", message: "   " });
    expect(details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
  });

  it("accepts a react-only delivery (no message)", async () => {
    const { ref, details } = await call(TWIN, { action: "react", emoji: "👍" });
    expect(details["error"]).toBeUndefined();
    expect(ref.value).toEqual({ action: "react", emoji: "👍" });
  });

  it("accepts a reply and defaults the destination to origin_thread (omitted)", async () => {
    const { ref } = await call(TWIN, { action: "reply", message: "On it — shipping today." });
    expect(ref.value).toEqual({ action: "reply", message: "On it — shipping today." });
    // origin_thread is the default, so destination is left undefined (not serialized).
    expect(ref.value?.destination).toBeUndefined();
  });

  it("accepts react_and_reply with both", async () => {
    const { ref } = await call(TWIN, { action: "react_and_reply", emoji: "✅", message: "done" });
    expect(ref.value).toEqual({ action: "react_and_reply", emoji: "✅", message: "done" });
  });

  it("resolves a channel destination from the explicit destination_channel_id", async () => {
    const { ref } = await call(TWIN, {
      action: "reply",
      message: "posting here",
      destination: "channel",
      destination_channel_id: "ch_eng",
      destination_reason: "eng-specific",
    });
    expect(ref.value?.destination).toEqual({ kind: "channel", channelId: "ch_eng" });
    expect(ref.value?.destinationReason).toBe("eng-specific");
  });

  it("rejects destination=channel with NO destination_channel_id", async () => {
    const { ref, details } = await call(TWIN, { action: "reply", message: "x", destination: "channel" });
    expect(details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
  });

  it("resolves a thread destination from channel + conversation ids", async () => {
    const { ref } = await call(TWIN, {
      action: "reply",
      message: "in the live thread",
      destination: "thread",
      destination_channel_id: "ch_eng",
      destination_conversation_id: "conv_123",
      destination_reason: "active thread",
    });
    expect(ref.value?.destination).toEqual({ kind: "thread", channelId: "ch_eng", conversationId: "conv_123" });
  });

  it("rejects destination=thread missing the conversation id", async () => {
    const { ref, details } = await call(TWIN, { action: "reply", message: "x", destination: "thread", destination_channel_id: "ch_eng" });
    expect(details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
  });

  it("dm_sender needs no id — DMs whoever mentioned the user", async () => {
    const { ref } = await call(TWIN, { action: "reply", message: "pinging you 1:1", destination: "dm_sender" });
    expect(ref.value?.destination).toEqual({ kind: "dm_sender" });
  });

  it("dm to ANYONE via dm_user_id (not just the sender)", async () => {
    const { ref } = await call(TWIN, {
      action: "reply",
      message: "looping you in",
      destination: "dm",
      dm_user_id: "user_abc",
      destination_reason: "the real owner",
    });
    expect(ref.value?.destination).toEqual({ kind: "dm", userId: "user_abc" });
    expect(ref.value?.destinationReason).toBe("the real owner");
  });

  it("rejects destination=dm with NO dm_user_id (use dm_sender instead)", async () => {
    const { ref, details } = await call(TWIN, { action: "reply", message: "x", destination: "dm" });
    expect(details["error"]).toBe(true);
    expect(ref.value).toBeUndefined();
  });

  it("ignores destination for a react-only action", async () => {
    const { ref } = await call(TWIN, { action: "react", emoji: "🎉", destination: "origin_channel" });
    expect(ref.value).toEqual({ action: "react", emoji: "🎉" });
    expect(ref.value?.destination).toBeUndefined();
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

describe("buildTwinDeliverMandate (system-prompt injection)", () => {
  it("always states the tool is the only output channel", () => {
    const m = buildTwinDeliverMandate();
    expect(m).toContain("Delivering your response — REQUIRED");
    expect(m).toContain("twin_deliver");
    // The idempotency reinforcement must be present in the prompt too.
    expect(m).toMatch(/Call it ONE time only/i);
  });

  it("emits the who/where line when senderName + channelName are provided", () => {
    const m = buildTwinDeliverMandate({ userName: "Pradeesh S", senderName: "Mamtha", channelName: "sebi-demo" });
    // This is the exact line that was MISSING from the real run — the whole RCA.
    expect(m).toContain("You were mentioned by **Mamtha** in **#sebi-demo**");
  });

  it("omits the who/where line entirely when sender/channel are absent (no dangling 'by **someone**')", () => {
    const m = buildTwinDeliverMandate({ userName: "Pradeesh S" });
    expect(m).not.toContain("You were mentioned by");
  });

  it("does NOT render the broken possessive '<name>r own' — uses 'your own first-person voice'", () => {
    const m = buildTwinDeliverMandate({ userName: "Pradeesh S" });
    expect(m).not.toContain("Pradeesh Sr own"); // the old ${you}r bug
    expect(m).toContain("your own first-person voice");
  });

  it("teaches the full destination model (origin/channel/thread/dm) WITH examples", () => {
    const m = buildTwinDeliverMandate();
    expect(m).toMatch(/Where the reply goes/i);
    expect(m).toContain("origin_thread");
    expect(m).toContain("origin_channel");
    expect(m).toContain("dm_sender");
    expect(m).toContain("dm_user_id");
    expect(m).toContain("destination_channel_id");
    expect(m).toContain("destination_conversation_id");
    expect(m).toContain("destination_reason");
    expect(m).toMatch(/Examples/);
    // guardrail: use Spaces tools to find ids, never guess
    expect(m).toMatch(/never guess an id/i);
    expect(m).toMatch(/Spaces tools/i);
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

  it("returns null when there is no twin_deliver call in the text", () => {
    expect(recoverTwinDeliveryFromText("just a normal answer with no tool call")).toBeNull();
    expect(recoverTwinDeliveryFromText('twin_deliver(action="reply")')).toBeNull(); // reply needs a message
    expect(recoverTwinDeliveryFromText("")).toBeNull();
  });
});
