import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resolveBaseUrl } from "./xyne-spaces-client.js";

const KEYS = ["XYNE_SPACES_URL", "SPACES_BACKEND_URL"] as const;

describe("resolveBaseUrl", () => {
  let saved: Record<string, string | undefined>;

  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    for (const k of KEYS) delete process.env[k];
  });

  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("falls back to SPACES_BACKEND_URL when XYNE_SPACES_URL is blank", () => {
    process.env["XYNE_SPACES_URL"] = "";
    process.env["SPACES_BACKEND_URL"] = "http://localhost:3001";
    expect(resolveBaseUrl()).toBe("http://localhost:3001");
  });

  it("falls back when XYNE_SPACES_URL is whitespace only", () => {
    process.env["XYNE_SPACES_URL"] = "   ";
    process.env["SPACES_BACKEND_URL"] = "http://localhost:3001";
    expect(resolveBaseUrl()).toBe("http://localhost:3001");
  });

  it("prefers XYNE_SPACES_URL when it is set", () => {
    process.env["XYNE_SPACES_URL"] = "http://spaces.internal";
    process.env["SPACES_BACKEND_URL"] = "http://localhost:3001";
    expect(resolveBaseUrl()).toBe("http://spaces.internal");
  });

  it("prefers a non-blank override over both env vars", () => {
    process.env["XYNE_SPACES_URL"] = "http://spaces.internal";
    expect(resolveBaseUrl("http://override")).toBe("http://override");
  });

  it("ignores a blank override", () => {
    process.env["SPACES_BACKEND_URL"] = "http://localhost:3001";
    expect(resolveBaseUrl("")).toBe("http://localhost:3001");
  });

  it("strips trailing slashes", () => {
    expect(resolveBaseUrl("http://localhost:3001///")).toBe("http://localhost:3001");
  });

  it("returns empty when nothing is configured", () => {
    expect(resolveBaseUrl()).toBe("");
  });
});
