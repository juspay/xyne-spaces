import { describe, expect, it, vi } from "vitest";

vi.mock("../services/storageService.js", () => ({ gcsService: {} }));
vi.mock("../redis.js", () => ({ redisService: {} }));

describe("dev emulator restore", () => {
  it("treats a down fake-gcs emulator as an empty archive outside production", async () => {
    const prevNode = process.env["NODE_ENV"];
    const prevHost = process.env["FAKE_GCS_HOST"];
    process.env["NODE_ENV"] = "development";
    process.env["FAKE_GCS_HOST"] = "localhost:4443";
    try {
      const { isDevEmulatorUnreachable } = await import("./sessions-archive.js");
      const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4443"), { code: "ECONNREFUSED" });
      expect(isDevEmulatorUnreachable(err)).toBe(true);
    } finally {
      if (prevNode === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNode;
      if (prevHost === undefined) delete process.env["FAKE_GCS_HOST"];
      else process.env["FAKE_GCS_HOST"] = prevHost;
    }
  });

  it("does not treat connection errors as an empty archive in production", async () => {
    const prevNode = process.env["NODE_ENV"];
    const prevHost = process.env["FAKE_GCS_HOST"];
    process.env["NODE_ENV"] = "production";
    process.env["FAKE_GCS_HOST"] = "localhost:4443";
    try {
      const { isDevEmulatorUnreachable } = await import("./sessions-archive.js");
      const err = Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:4443"), { code: "ECONNREFUSED" });
      expect(isDevEmulatorUnreachable(err)).toBe(false);
    } finally {
      if (prevNode === undefined) delete process.env["NODE_ENV"];
      else process.env["NODE_ENV"] = prevNode;
      if (prevHost === undefined) delete process.env["FAKE_GCS_HOST"];
      else process.env["FAKE_GCS_HOST"] = prevHost;
    }
  });
});

describe("session archive identifiers", () => {
  it("accepts Claw store keys through the runtime's 128-character limit", async () => {
    const { isSafeConversationId } = await import("./sessions-archive.js");
    const sdlcConversationId =
      "chat-sdlc-setup-cmsegpz6z001usrtig8j2mko7-core_code_map-7acde1a5-86f1-431d-96bf-4b92d426a313";
    const storeKey = `${sdlcConversationId}_sdlc-agent`;

    expect(storeKey).toHaveLength(103);
    expect(isSafeConversationId(storeKey)).toBe(true);
    expect(isSafeConversationId("x".repeat(128))).toBe(true);
    expect(isSafeConversationId("x".repeat(129))).toBe(false);
    expect(isSafeConversationId("unsafe/path")).toBe(false);
  });
});
