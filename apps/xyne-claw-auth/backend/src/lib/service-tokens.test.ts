import { describe, expect, it, vi } from "vitest";

// service-tokens.ts transitively imports cli-tokens.ts -> db.js. Stub the DB so
// this stays a pure unit test with no Prisma connection.
vi.mock("../db.js", () => ({ prisma: {} }));
vi.mock("../logger.js", () => ({ createLogger: () => ({ info() {}, warn() {}, error() {}, debug() {} }) }));

import {
  CHANNELS_POST_SCOPE,
  SERVICE_TOKEN_SCOPES,
  canPostToChannels,
  sanitizeExternalRunBody,
} from "./service-tokens.js";

describe("canPostToChannels", () => {
  it("is false for the default minted scope set", () => {
    expect(canPostToChannels(SERVICE_TOKEN_SCOPES)).toBe(false);
  });

  it("is true only when the elevated scope is present", () => {
    expect(canPostToChannels([...SERVICE_TOKEN_SCOPES, CHANNELS_POST_SCOPE])).toBe(true);
    expect(CHANNELS_POST_SCOPE).toBe("spaces:channels:post");
  });
});

describe("sanitizeExternalRunBody", () => {
  const body = {
    task: "do the thing",
    agentSlug: "npci-program-management-agent",
    triggerSource: "api",
    channelId: "cms6363ip1mtunk2t8co0z5rd",
    deliverTo: "dm",
    provider: "claude", // non-contract field — must always be dropped
  };

  it("drops channel-delivery fields by default (no scope)", () => {
    const { sanitized, dropped } = sanitizeExternalRunBody({ ...body });
    expect(sanitized).not.toHaveProperty("channelId");
    expect(sanitized).not.toHaveProperty("deliverTo");
    expect(dropped).toContain("channelId");
    expect(dropped).toContain("deliverTo");
    expect(dropped).toContain("provider");
    expect(sanitized["task"]).toBe("do the thing");
  });

  it("keeps channelId/deliverTo when channel delivery is allowed", () => {
    const { sanitized, dropped } = sanitizeExternalRunBody({ ...body }, { allowChannelDelivery: true });
    expect(sanitized["channelId"]).toBe("cms6363ip1mtunk2t8co0z5rd");
    expect(sanitized["deliverTo"]).toBe("dm");
    expect(dropped).not.toContain("channelId");
    expect(dropped).not.toContain("deliverTo");
    // Unrelated non-contract fields are still stripped even with the scope.
    expect(dropped).toContain("provider");
    expect(sanitized).not.toHaveProperty("provider");
  });
});
