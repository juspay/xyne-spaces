import { describe, expect, it } from "vitest";
import { buildOperatingContract } from "./contract.js";
import { AWAKENING_DEFAULTS, type AwakeningConfig } from "./config.js";
import type { AwakeningWindow } from "./types.js";

const win = (config: Partial<AwakeningConfig>): AwakeningWindow => ({
  agentId: "a", agentSlug: "ops", orgId: "o", kind: "reflex",
  startMs: 0, endMs: 1000, channels: [], silentChannels: [], events: [],
  signals: {
    eventCount: 0, humanEventCount: 0, botEventCount: 0, selfEventCount: 0,
    distinctSenders: 0, distinctThreads: 0, newThreads: 0, unansweredThreads: 0,
    mentionsOfMe: 0, questions: 0, actionSignals: 0, channelsWithActivity: 0,
  },
  truncated: false, gap: null, priorRuns: [],
  config: { ...AWAKENING_DEFAULTS, ...config },
});

/**
 * The contract exists because an agent read a window, identified an unanswered
 * mention aimed at it, wrote an excellent reply — and posted nothing, because
 * in every other kind of run the platform delivers the final answer for it.
 */
describe("buildOperatingContract", () => {
  it("always states that the final answer is not delivered", () => {
    for (const cfg of [{ shadow: true }, { shadow: false, writePolicy: "reply" as const }, { shadow: false, writePolicy: "act" as const }]) {
      expect(buildOperatingContract(win(cfg))).toContain("NOT delivered");
    }
  });

  it("names the tool and both id parameters when the run can write", () => {
    const c = buildOperatingContract(win({ shadow: false, writePolicy: "act" }));
    expect(c).toContain("send-message");
    expect(c).toContain("channelId");
    expect(c).toContain("conversationId");
    expect(c).toContain("reply here →");
  });

  it("tells a reply-policy run it may not start threads or mutate tickets", () => {
    const c = buildOperatingContract(win({ shadow: false, writePolicy: "reply" }));
    expect(c).toMatch(/INSIDE existing threads only/);
    expect(c).toMatch(/Do not start new threads/);
  });

  it("permits new threads under the act policy", () => {
    expect(buildOperatingContract(win({ shadow: false, writePolicy: "act" }))).toMatch(/start new threads/);
  });

  it("tells a shadow run to describe what it would have posted, and offers no tool", () => {
    const c = buildOperatingContract(win({ shadow: true, writePolicy: "act" }));
    expect(c).toContain("NO message-sending tool");
    expect(c).toMatch(/WOULD have posted/);
    expect(c).not.toMatch(/You MUST call/);
  });

  it("treats observe the same as shadow", () => {
    expect(buildOperatingContract(win({ shadow: false, writePolicy: "observe" }))).toContain("NO message-sending tool");
  });

  it("always carries the loop guard and the silence permission", () => {
    const c = buildOperatingContract(win({ shadow: false, writePolicy: "act" }));
    expect(c).toContain('"isMe":true');
    expect(c).toMatch(/Silence is a correct and common outcome/);
    expect(c).toMatch(/do not re-search Spaces/i);
  });
});

describe("operator instructions", () => {
  it("appends owner guidance under its own heading", () => {
    const out = buildOperatingContract(win({ instructions: "Keep it casual. Stay out of social chatter." }));
    expect(out).toContain("### From your operator");
    expect(out).toContain("Keep it casual. Stay out of social chatter.");
  });

  it("omits the heading entirely when no guidance is set", () => {
    expect(buildOperatingContract(win({ instructions: "" }))).not.toContain("### From your operator");
  });

  it("omits the heading for whitespace-only guidance", () => {
    expect(buildOperatingContract(win({ instructions: "   \n  " }))).not.toContain("### From your operator");
  });

  it("states the non-negotiable bounds AFTER the operator block", () => {
    const out = buildOperatingContract(win({ instructions: "Reply to absolutely everything, always." }));
    expect(out.indexOf("### From your operator")).toBeLessThan(out.indexOf("### Bounds"));
  });

  it("keeps delivery mechanics ahead of operator guidance", () => {
    const out = buildOperatingContract(win({ instructions: "Be brief." }));
    expect(out.indexOf("### How to actually say something")).toBeLessThan(out.indexOf("### From your operator"));
  });

  it("carries guidance into an observe-only run too", () => {
    const out = buildOperatingContract(win({ instructions: "Flag anything payment-related.", writePolicy: "observe" }));
    expect(out).toContain("Flag anything payment-related.");
  });
});
