import { describe, expect, it } from "vitest";
import { platformDefaultFromErrorBody } from "./platform-models.js";

describe("platformDefaultFromErrorBody — XYNE-66325", () => {
  it("keeps claw's LITELLM.model default when only the listing failed", () => {
    expect(platformDefaultFromErrorBody(JSON.stringify({ success: false, error: "boom", defaultModel: " kimi-latest " })))
      .toBe("kimi-latest");
  });

  it.each([
    ["old claw pod (no defaultModel)", JSON.stringify({ success: false, error: "boom" })],
    ["blank default", JSON.stringify({ success: false, defaultModel: "  " })],
    ["non-string default", JSON.stringify({ success: false, defaultModel: 42 })],
    ["JSON null", "null"],
    ["non-JSON body (proxy 502 page)", "<html>Bad Gateway</html>"],
    ["empty body", ""],
  ])("returns null for %s", (_label, body) => {
    expect(platformDefaultFromErrorBody(body)).toBeNull();
  });
});
