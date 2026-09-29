import { beforeEach, describe, expect, it, vi } from "vitest";

const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
const activeRun = vi.fn(async (..._args: unknown[]) => ({ sessionId: "sess-1", agentSlug: "xyne", startedAt: 0 }) as { sessionId: string; agentSlug: string; startedAt: number } | null);

vi.mock("./delivery.js", () => ({ enqueueOutbound }));
vi.mock("./commands.js", () => ({ activeRun }));

const { sendInterimMessage } = await import("./interim.js");

const target = { channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "k", chatId: "919", senderId: "919", isGroup: false } as never;

beforeEach(() => {
  enqueueOutbound.mockClear();
  activeRun.mockResolvedValue({ sessionId: "sess-1", agentSlug: "xyne", startedAt: 0 });
});

describe("sendInterimMessage", () => {
  it("sends the model's line to the chat", async () => {
    await expect(sendInterimMessage("sess-1", target, "  2 of your 3 PRs have failing CI ")).resolves.toBe(true);
    expect(enqueueOutbound).toHaveBeenCalledWith("acc", { kind: "text", chatId: "919", text: "2 of your 3 PRs have failing CI", markdown: true });
  });

  it("drops empty text and lines from a run that is no longer the chat's current one", async () => {
    await expect(sendInterimMessage("sess-1", target, "   ")).resolves.toBe(false);
    activeRun.mockResolvedValueOnce({ sessionId: "sess-2", agentSlug: "xyne", startedAt: 0 });
    await expect(sendInterimMessage("sess-1", target, "late line")).resolves.toBe(false);
    activeRun.mockResolvedValueOnce(null);
    await expect(sendInterimMessage("sess-1", target, "after the answer")).resolves.toBe(false);
    expect(enqueueOutbound).not.toHaveBeenCalled();
  });
});
