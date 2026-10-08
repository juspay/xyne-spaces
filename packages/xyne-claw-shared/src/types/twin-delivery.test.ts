import { describe, it, expect } from "vitest";
import { TWIN_DELIVERY_ACTIONS, isTwinDelivery, isTwinDeliveryAction, twinDeliveryParts } from "./twin-delivery.js";

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

describe("TWIN_DELIVERY_ACTIONS / isTwinDeliveryAction / twinDeliveryParts", () => {
  it("lists the four actions in tool-schema order", () => {
    expect(TWIN_DELIVERY_ACTIONS).toEqual(["react", "reply", "react_and_reply", "ignore"]);
  });
  it("isTwinDeliveryAction accepts only the listed action strings", () => {
    expect(isTwinDeliveryAction("react_and_reply")).toBe(true);
    expect(isTwinDeliveryAction("shout")).toBe(false);
    expect(isTwinDeliveryAction(undefined)).toBe(false);
  });
  it("twinDeliveryParts says which of emoji/message an action carries", () => {
    expect([...TWIN_DELIVERY_ACTIONS, "shout"].map(twinDeliveryParts)).toEqual([
      { emoji: true, message: false },
      { emoji: false, message: true },
      { emoji: true, message: true },
      { emoji: false, message: false },
      { emoji: false, message: false },
    ]);
  });
});
