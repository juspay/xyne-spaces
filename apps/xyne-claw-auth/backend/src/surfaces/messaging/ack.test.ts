import { describe, expect, it } from "vitest";
import { pickAckReaction } from "./ack.js";
import { DEFAULT_ACK_REACTION } from "./const.js";

const d = DEFAULT_ACK_REACTION;
const ack = (text: string) => pickAckReaction(text, d);

describe("pickAckReaction", () => {
  it("matches common workplace requests", () => {
    expect(ack("create a new landing page")).toBe("\u{2728}");
    expect(ack("debug the login flow")).toBe("\u{1F527}");
    expect(ack("the checkout is broken")).toBe("\u{1F41B}");
    expect(ack("deploy to staging")).toBe("\u{1F680}");
    expect(ack("write the release notes")).toBe("\u{270D}\u{FE0F}");
    expect(ack("find the onboarding doc")).toBe("\u{1F4C4}");
    expect(ack("schedule a sync tomorrow")).toBe("\u{1F4C5}");
    expect(ack("raise a ticket for this")).toBe("\u{1F3AB}");
    expect(ack("run the tests")).toBe("\u{1F9EA}");
    expect(ack("review my pull request")).toBe("\u{1F9D0}");
    expect(ack("what is our refund policy")).toBe("\u{1F4C4}");
    expect(ack("pull last month's revenue")).toBe("\u{1F4B0}");
    expect(ack("translate this to Hindi")).toBe("\u{1F310}");
    expect(ack("rotate the API token")).toBe("\u{1F510}");
  });

  it("puts the problem ahead of the pleasantry", () => {
    expect(ack("hi, the login page crashed")).toBe("\u{1F41B}");
    expect(ack("hi there")).toBe("\u{1F44B}");
    expect(ack("thanks for that")).toBe("\u{1F64F}");
  });

  it("treats a bare question as one", () => {
    expect(ack("how does billing work")).toBe("\u{1F914}");
    expect(ack("who owns this?")).toBe("\u{1F914}");
    // A question about a named thing acks as the thing — more useful than 🤔.
    expect(ack("is the migration done?")).toBe("\u{1F5C4}\u{FE0F}");
  });

  it("falls back to the default when nothing matches", () => {
    expect(ack("the quarterly offsite in Goa")).toBe(d);
    expect(ack("   ")).toBe(d);
  });

  it("never overrides an admin's own choice", () => {
    expect(pickAckReaction("the checkout is broken", "\u{1F680}")).toBe("\u{1F680}");
  });
});
