import { describe, expect, it } from "vitest";
import { withOrigin } from "../src/backendClient.js";

describe("withOrigin", () => {
  it("points a localhost callback at the host as seen from a container", () => {
    expect(withOrigin("http://localhost:3001/api/meet-bot/sessions/abc", "http://host.containers.internal:3001")).toBe(
      "http://host.containers.internal:3001/api/meet-bot/sessions/abc",
    );
  });

  it("leaves the URL alone without an override", () => {
    expect(withOrigin("https://api.example/x", undefined)).toBe("https://api.example/x");
  });
});
