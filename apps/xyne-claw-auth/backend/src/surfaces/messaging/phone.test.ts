import { describe, expect, it } from "vitest";
import { normalizePhoneDigits } from "./phone.js";

describe("normalizePhoneDigits", () => {
  it("assumes +91 for a bare ten-digit number", () => {
    expect(normalizePhoneDigits("9876543210")).toBe("919876543210");
    expect(normalizePhoneDigits("098765 43210")).toBe("919876543210");
  });

  it("leaves an explicit country code alone", () => {
    expect(normalizePhoneDigits("+1 555 172 2120")).toBe("15551722120");
    expect(normalizePhoneDigits("+91 98765 43210")).toBe("919876543210");
  });

  it("does not prepend a country code to a number that already has one", () => {
    expect(normalizePhoneDigits("919876543210")).toBe("919876543210");
  });

  it("rejects anything that is not a plausible number", () => {
    expect(normalizePhoneDigits("")).toBeNull();
    expect(normalizePhoneDigits("12345")).toBeNull();
    expect(normalizePhoneDigits("call me")).toBeNull();
  });
});
