import { describe, expect, it, vi } from "vitest";

vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));
vi.mock("../../config.js", () => ({ CONFIG: { internalUrl: "http://localhost", xyneClawS2sKey: "" } }));

const { sendOutbound } = await import("./delivery.js");
type OutboxItem = Parameters<typeof sendOutbound>[2];

const resultSections = { maxWords: 100, maxSections: 5 };

function plugin(sections: boolean) {
  const sendText = vi.fn().mockResolvedValue({ chatId: "c", messageId: "t" });
  const sendMedia = vi.fn().mockResolvedValue({ chatId: "c", messageId: "m" });
  const p = {
    capabilities: { maxTextChars: 4096, media: true, typing: false, reactions: false, groups: true, ...(sections ? { resultSections } : {}) },
    sendText,
    sendMedia,
    formatText: (t: string) => t,
  } as never;
  return { p, sendText, sendMedia };
}

const longAnswer = Array.from({ length: 7 }, (_, i) => `## Part ${i + 1}\n${Array.from({ length: 30 }, () => "word").join(" ")}`).join("\n\n");
const result = (text: string): OutboxItem => ({ kind: "result", chatId: "c", status: "completed", result: text });

describe("sectioned result delivery", () => {
  it("sends an answer that still does not fit as one message per section, with nothing cut", async () => {
    const { p, sendText, sendMedia } = plugin(true);
    await sendOutbound(p, {}, result(longAnswer));
    expect(sendText).toHaveBeenCalledTimes(7);
    expect(sendText.mock.calls[0]?.[2]).toContain("## Part 1");
    expect(sendText.mock.calls[6]?.[2]).toContain("## Part 7");
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("sends a short answer as-is with no file", async () => {
    const { p, sendText, sendMedia } = plugin(true);
    await sendOutbound(p, {}, result("Just a quick answer."));
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[2]).toBe("Just a quick answer.");
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("leaves channels without the capability unchanged", async () => {
    const { p, sendText, sendMedia } = plugin(false);
    await sendOutbound(p, {}, result(longAnswer));
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("does not section a failed run", async () => {
    const { p, sendText, sendMedia } = plugin(true);
    await sendOutbound(p, {}, { kind: "result", chatId: "c", status: "failed", result: longAnswer });
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("resumes after the sections that already landed", async () => {
    const { p, sendText } = plugin(true);
    await sendOutbound(p, {}, result(longAnswer), { chunks: 3, attachments: 0 });
    expect(sendText).toHaveBeenCalledTimes(4);
    expect(sendText.mock.calls[0]?.[2]).toContain("## Part 4");
  });
});
