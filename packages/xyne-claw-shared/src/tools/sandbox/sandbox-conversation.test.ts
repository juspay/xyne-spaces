import { describe, expect, it } from "vitest";
import { buildSandboxStoreKey, sandboxConversationIdFromMeta } from "./index.js";

describe("sandboxConversationIdFromMeta", () => {
  it("uses the run-scoped sandbox id for a run without a conversation", () => {
    const meta = { userId: "u1", agentSlug: "euler-doctor", sandboxConversationId: "wf-cmexec0001-a1b2c3d4-t1-r0" };
    expect(sandboxConversationIdFromMeta(meta)).toBe("wf-cmexec0001-a1b2c3d4-t1-r0");
    expect(buildSandboxStoreKey(meta.userId, sandboxConversationIdFromMeta(meta), meta.agentSlug)).toBeTruthy();
  });

  it("uses the conversation when there is one, and nothing when there is neither", () => {
    expect(sandboxConversationIdFromMeta({ conversationId: "conv-1" })).toBe("conv-1");
    expect(sandboxConversationIdFromMeta({ userId: "u1" })).toBeUndefined();
    expect(sandboxConversationIdFromMeta(undefined)).toBeUndefined();
  });
});
