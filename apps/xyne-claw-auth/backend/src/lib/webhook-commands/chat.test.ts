/**
 * The shared slash-command handlers when the command came from a messaging
 * chat (ctx.channelDelivery set) rather than a Spaces thread: nothing may go
 * through the Spaces app, and chat-only commands are listed in /help.
 */
import { describe, expect, it, vi } from "vitest";

const postGoalPhase = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("../goal-phase.js", () => ({ postGoalPhase }));
vi.mock("../../services/goalRelooper.js", () => ({ handleSlashCommandBeforeRun: vi.fn() }));

const { handleHelp } = await import("./help.js");
const { announceGoalStart } = await import("./goal.js");

function ctx(chat: boolean) {
  const reply = vi.fn(async (..._args: unknown[]) => undefined);
  return {
    reply,
    value: {
      agent: { id: "a", slug: "assistant", name: "Assistant", orgId: "o", appToken: "", spacesAppId: "", spacesAppUserId: "", isDefault: false },
      payload: { conversationId: "whatsapp-cloud-acct_1-assistant-919", channelId: "919", userId: "u" },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      userText: "",
      taskCommandText: "",
      immediateTaskCommand: false,
      autoGoalEnabled: false,
      isTwin: false,
      reply,
      attach: vi.fn(),
      reconcileStoppedRuns: vi.fn(),
      ...(chat
        ? { channelDelivery: { channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "k", chatId: "919", senderId: "919", isGroup: false } }
        : {}),
    } as never,
  };
}

describe("/help", () => {
  it("adds the chat's own commands only in a chat", async () => {
    const inChat = ctx(true);
    await handleHelp(inChat.value);
    const chatText = inChat.reply.mock.calls[0]?.[0] as string;
    expect(chatText).toContain("`/debug`");
    expect(chatText).toContain("*In this chat*");
    expect(chatText).toContain("`/agents`");

    const inThread = ctx(false);
    await handleHelp(inThread.value);
    expect(inThread.reply.mock.calls[0]?.[0] as string).not.toContain("*In this chat*");
  });
});

describe("/goal start", () => {
  it("says so in the chat, where there is no progress pill", async () => {
    const inChat = ctx(true);
    await announceGoalStart(inChat.value, "Starting /goal: tests pass", "pre-dispatch");
    expect(inChat.reply).toHaveBeenCalledWith("Starting /goal: tests pass", expect.any(String));
    expect(postGoalPhase).not.toHaveBeenCalled();
  });
});
