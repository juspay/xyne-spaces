import { describe, expect, it } from "vitest";
import { CHALLENGE_RE } from "./const.js";

describe("hub.challenge echo", () => {
  it("accepts the opaque tokens a provider actually sends", () => {
    for (const challenge of ["1158201444", "abc123", "A-token_1"]) {
      expect(CHALLENGE_RE.test(challenge)).toBe(true);
    }
  });

  it("refuses anything that would make the endpoint reflect markup", () => {
    for (const challenge of ["<script>alert(1)</script>", '"><img src=x onerror=1>', "a b", ""]) {
      expect(CHALLENGE_RE.test(challenge)).toBe(false);
    }
  });

  it("refuses a challenge long enough to be a payload rather than a token", () => {
    expect(CHALLENGE_RE.test("a".repeat(257))).toBe(false);
  });
});
