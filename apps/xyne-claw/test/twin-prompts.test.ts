import { describe, it, expect } from "vitest";
import { buildTwinDeliverMandate, buildTwinSystemPrompt } from "../src/twin-prompts.js";

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

  it("teaches the PRIVATE cited reasoning (the Why panel) with verbatim clf- tokens", () => {
    const m = buildTwinDeliverMandate({ userName: "Pradeesh S" });
    expect(m).toMatch(/reasoning/);
    expect(m).toMatch(/Why\?/);
    expect(m).toMatch(/never posted/i);
    expect(m).toContain("[clf-…#n]");
    // the message must stay citation-free — the split is explicit
    expect(m).toMatch(/message.*citation-free|citation-free/i);
  });
});

describe("buildTwinDeliverMandate (empty names)", () => {
  it("treats empty-string names like omitted ones", () => {
    expect(buildTwinDeliverMandate({ userName: "", senderName: "", channelName: "c" })).toBe(
      buildTwinDeliverMandate({ channelName: "c" }),
    );
    expect(buildTwinDeliverMandate({ userName: undefined, senderName: undefined, channelName: undefined })).toBe(
      buildTwinDeliverMandate(),
    );
  });
});

describe("buildTwinSystemPrompt (no-override fallback prompt)", () => {
  it("names the user and appends the delivery mandate when mandateDeliver is set", () => {
    const p = buildTwinSystemPrompt("Name", "e@x", true);
    expect(p).toContain("You are the **Digital Twin** of **Name**");
    expect(p).toContain("- **Email:** e@x");
    expect(p.endsWith(buildTwinDeliverMandate({ userName: "Name" }))).toBe(true);
  });

  it("omits the delivery mandate by default", () => {
    const p = buildTwinSystemPrompt("Name", "e@x");
    expect(p).not.toContain("Delivering your response");
  });

  it("falls back to generic wording when the user is unknown", () => {
    const p = buildTwinSystemPrompt();
    expect(p).toContain("You are the **Digital Twin** of the user");
    expect(p).toContain("- **Name:** unknown");
    expect(p).not.toContain("- **Email:**");
  });
});
