import { describe, expect, it, vi } from "vitest";

vi.mock("../services/storageService.js", () => ({ gcsService: {} }));
vi.mock("../redis.js", () => ({ redisService: {} }));

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
