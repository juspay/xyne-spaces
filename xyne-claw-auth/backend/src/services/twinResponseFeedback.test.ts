import { describe, it, expect } from "vitest";
import { renderTwinFeedbackRecord } from "./twinResponseFeedback.js";

function row(overrides: Partial<Parameters<typeof renderTwinFeedbackRecord>[0]> = {}) {
  return renderTwinFeedbackRecord({
    id: "fb1",
    channelId: "ch1",
    channelName: "engineering",
    incomingTask: "can you review the PR?",
    deliveryAction: "reply",
    deliveryEmoji: null,
    draftMessage: "Sure, taking a look now.",
    finalMessage: null,
    status: "accepted",
    decidedAt: new Date("2026-07-18T10:00:00Z"),
    ...overrides,
  });
}

describe("renderTwinFeedbackRecord", () => {
  it("always includes the incoming message + channel as context", () => {
    const r = row();
    expect(r.text).toContain("engineering");
    expect(r.text).toContain("can you review the PR?");
    expect(r.channelId).toBe("ch1");
    expect(r.channelName).toBe("engineering");
    expect(r.type).toBe("mention_reply");
    expect(r.id).toBe("twin-feedback:fb1");
    expect(r.ts).toBe("2026-07-18T10:00:00.000Z");
  });

  it("accepted → positive reinforcement, quotes the posted text", () => {
    const r = row({ status: "accepted", finalMessage: "Sure, on it." });
    expect(r.text).toContain("APPROVED");
    expect(r.text).toContain("AS-IS");
    expect(r.text).toContain("Sure, on it.");
    expect(r.text.toLowerCase()).toContain("matched");
  });

  it("accepted_edited → surfaces the draft→final delta", () => {
    const r = row({
      status: "accepted_edited",
      draftMessage: "Sure, taking a look now.",
      finalMessage: "yep looking now, will ping in 10",
    });
    expect(r.text).toContain("EDITED");
    expect(r.text).toContain("Sure, taking a look now.");
    expect(r.text).toContain("yep looking now, will ping in 10");
  });

  it("declined → negative signal, tells the twin to avoid this", () => {
    const r = row({ status: "declined", draftMessage: "No worries, I'll handle it." });
    expect(r.text).toContain("DECLINED");
    expect(r.text).toContain("NOT how they would respond");
    expect(r.text).toContain("No worries, I'll handle it.");
  });

  it("ignored → weak/negative signal", () => {
    const r = row({ status: "ignored" });
    expect(r.text).toContain("IGNORED");
    expect(r.text.toLowerCase()).toContain("weak");
  });

  it("notes an emoji reaction when the delivery included one", () => {
    const r = row({ status: "accepted", deliveryAction: "react_and_reply", deliveryEmoji: "👍", finalMessage: "done" });
    expect(r.text).toContain("👍");
  });

  it("handles a missing channel name gracefully", () => {
    const r = row({ channelName: null, channelId: null });
    expect(r.text).toContain("Someone messaged the user:");
    expect(r.channelId).toBeUndefined();
  });
});
