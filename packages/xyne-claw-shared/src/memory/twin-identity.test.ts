import { describe, it, expect } from "vitest";
import {
  bankIdForAgent,
  DIGITAL_TWIN_SLUG,
  DIGITAL_TWIN_BANK_ID,
  isDigitalTwinAgent,
} from "./types.js";

describe("digital twin identity", () => {
  it("pins the slug and the persisted Hindsight bank id", () => {
    expect(DIGITAL_TWIN_SLUG).toBe("digital-twin");
    expect(DIGITAL_TWIN_BANK_ID).toBe("xyne-digital-twin");
    expect(DIGITAL_TWIN_BANK_ID).toBe(bankIdForAgent("digital-twin"));
  });

  it("matches every slug that sanitizes onto the twin bank", () => {
    expect(isDigitalTwinAgent("digital-twin")).toBe(true);
    expect(isDigitalTwinAgent("Digital--Twin")).toBe(true);
    expect(isDigitalTwinAgent("digital_twin")).toBe(true);
  });

  it("rejects empty, blank, nullish and other agents", () => {
    expect(isDigitalTwinAgent("")).toBe(false);
    expect(isDigitalTwinAgent("  ")).toBe(false);
    expect(isDigitalTwinAgent(undefined)).toBe(false);
    expect(isDigitalTwinAgent(null)).toBe(false);
    expect(isDigitalTwinAgent("assistant")).toBe(false);
  });
});
