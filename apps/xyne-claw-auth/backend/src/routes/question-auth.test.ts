import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isSpacesBotUser: vi.fn<(userId: string) => Promise<boolean>>(),
  isActiveHumanChannelMember: vi.fn<(channelId: string, userId: string) => Promise<boolean>>(),
}));

vi.mock("../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));
vi.mock("../lib/spaces-db.js", () => ({
  isSpacesBotUser: mocks.isSpacesBotUser,
  isActiveHumanChannelMember: mocks.isActiveHumanChannelMember,
}));

import { authorizeQuestionAnswerer } from "./question-auth.js";

const CALLER = "user-human-0001";
const OTHER_HUMAN = "user-human-0002";
const BOT = "bot-automation-0001";
const CHANNEL = "channel-0001";

describe("authorizeQuestionAnswerer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows when caller matches the baked answerer (human-baked card, no DB calls)", async () => {
    const verdict = await authorizeQuestionAnswerer({
      callerUserId: CALLER,
      answerUserId: CALLER,
      channelId: CHANNEL,
    });
    expect(verdict).toEqual({ allowed: true, reason: "caller-matches" });
    expect(mocks.isSpacesBotUser).not.toHaveBeenCalled();
    expect(mocks.isActiveHumanChannelMember).not.toHaveBeenCalled();
  });

  it("allows a human channel member answering a bot-baked card (the fix)", async () => {
    mocks.isSpacesBotUser.mockResolvedValue(true);
    mocks.isActiveHumanChannelMember.mockResolvedValue(true);
    const verdict = await authorizeQuestionAnswerer({
      callerUserId: CALLER,
      answerUserId: BOT,
      channelId: CHANNEL,
    });
    expect(verdict).toEqual({ allowed: true, reason: "bot-baked-human-member" });
    expect(mocks.isSpacesBotUser).toHaveBeenCalledWith(BOT);
    expect(mocks.isActiveHumanChannelMember).toHaveBeenCalledWith(CHANNEL, CALLER);
  });

  it("denies a caller who is not a member of the card's channel (bot-baked)", async () => {
    mocks.isSpacesBotUser.mockResolvedValue(true);
    mocks.isActiveHumanChannelMember.mockResolvedValue(false);
    const verdict = await authorizeQuestionAnswerer({
      callerUserId: CALLER,
      answerUserId: BOT,
      channelId: CHANNEL,
    });
    expect(verdict).toEqual({ allowed: false, reason: "caller-not-channel-member" });
  });

  it("denies when the answerer is a human other than the caller (prod rule unchanged)", async () => {
    mocks.isSpacesBotUser.mockResolvedValue(false);
    const verdict = await authorizeQuestionAnswerer({
      callerUserId: CALLER,
      answerUserId: OTHER_HUMAN,
      channelId: CHANNEL,
    });
    expect(verdict).toEqual({ allowed: false, reason: "answerer-not-bot" });
    expect(mocks.isActiveHumanChannelMember).not.toHaveBeenCalled();
  });

  it("fails closed on missing identity fields", async () => {
    for (const ctx of [
      { callerUserId: "", answerUserId: BOT, channelId: CHANNEL },
      { callerUserId: CALLER, answerUserId: "", channelId: CHANNEL },
      { callerUserId: CALLER, answerUserId: BOT, channelId: "" },
    ]) {
      const verdict = await authorizeQuestionAnswerer(ctx);
      expect(verdict.allowed).toBe(false);
      expect(verdict.reason).toBe("missing-identity");
    }
    expect(mocks.isSpacesBotUser).not.toHaveBeenCalled();
  });

  it("fails closed when the spaces-db lookup throws", async () => {
    mocks.isSpacesBotUser.mockRejectedValue(new Error("db down"));
    const verdict = await authorizeQuestionAnswerer({
      callerUserId: CALLER,
      answerUserId: BOT,
      channelId: CHANNEL,
    });
    expect(verdict).toEqual({ allowed: false, reason: "db-error" });
  });

  it("fails closed when the membership lookup throws", async () => {
    mocks.isSpacesBotUser.mockResolvedValue(true);
    mocks.isActiveHumanChannelMember.mockRejectedValue(new Error("db down"));
    const verdict = await authorizeQuestionAnswerer({
      callerUserId: CALLER,
      answerUserId: BOT,
      channelId: CHANNEL,
    });
    expect(verdict).toEqual({ allowed: false, reason: "db-error" });
  });
});
