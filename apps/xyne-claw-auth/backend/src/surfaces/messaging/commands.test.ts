import { describe, expect, it, vi } from "vitest";

vi.mock("../../config.js", () => ({ CONFIG: { internalUrl: "http://localhost", xyneClawS2sKey: "k" } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));

const { parseControlCommand, describeElapsed } = await import("./commands.js");

describe("parseControlCommand", () => {
  it("recognises the three commands and their aliases", () => {
    expect(parseControlCommand("/new")).toBe("new");
    expect(parseControlCommand("/reset")).toBe("new");
    // `/clear` is what Spaces calls it; one thing should not have two names.
    expect(parseControlCommand("/clear")).toBe("new");
    expect(parseControlCommand("/stop")).toBe("stop");
    expect(parseControlCommand("/cancel")).toBe("stop");
    expect(parseControlCommand("/abort")).toBe("stop");
    expect(parseControlCommand("/status")).toBe("status");
  });

  it("accepts the @ prefix and odd spacing", () => {
    expect(parseControlCommand("  @stop  ")).toBe("stop");
    expect(parseControlCommand("/STATUS")).toBe("status");
  });

  it("leaves anything with an argument alone", () => {
    // "/new ticket for the outage" is a request, not a command.
    expect(parseControlCommand("/new ticket for the outage")).toBeNull();
    expect(parseControlCommand("/stop the deploy")).toBeNull();
  });

  it("is not fooled by a word that merely contains one", () => {
    expect(parseControlCommand("stop")).toBeNull();
    expect(parseControlCommand("/newsletter")).toBeNull();
    expect(parseControlCommand("can you /stop")).toBeNull();
  });
});

describe("describeElapsed", () => {
  it("reads as a person would say it", () => {
    expect(describeElapsed(Date.now() - 1_000)).toBe("1 second");
    expect(describeElapsed(Date.now() - 40_000)).toBe("40 seconds");
    // Seconds stay seconds up to 90, so "2 minutes" never means 91 seconds.
    expect(describeElapsed(Date.now() - 60_000)).toBe("60 seconds");
    expect(describeElapsed(Date.now() - 120_000)).toBe("2 minutes");
    expect(describeElapsed(Date.now() - 180_000)).toBe("3 minutes");
  });
});
