import { describe, expect, it, vi } from "vitest";

// config.ts reads required env at import time and delivery.ts only needs Redis
// for the enqueue helpers, which these tests never touch.
vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("../../logger.js", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));
// commands.ts reads required env at import time; these tests never call it.
vi.mock("../../config.js", () => ({ CONFIG: { internalUrl: "http://localhost", xyneClawS2sKey: "" } }));

const { sendOutbound, PartialSendError } = await import("./delivery.js");
type OutboxItem = Parameters<typeof sendOutbound>[2];

function plugin(sendText: ReturnType<typeof vi.fn>, sendMedia = vi.fn()) {
  return {
    capabilities: { maxTextChars: 20, media: true, typing: false, reactions: false, groups: true },
    sendText,
    sendMedia,
    formatText: (t: string) => t,
  } as never;
}

const longText = "aaaaaaaaaa\n\nbbbbbbbbbb\n\ncccccccccc"; // three chunks at max 20

describe("partial send resume", () => {
  it("reports how far it got when a chunk fails", async () => {
    const sendText = vi.fn()
      .mockResolvedValueOnce({ chatId: "c", messageId: "1" })
      .mockRejectedValueOnce(new Error("socket closed"));
    const item: OutboxItem = { kind: "text", chatId: "c", text: longText };
    await expect(sendOutbound(plugin(sendText), {}, item)).rejects.toBeInstanceOf(PartialSendError);
    expect(sendText).toHaveBeenCalledTimes(2);
  });

  it("skips the chunks that already landed on the retry", async () => {
    const sendText = vi.fn().mockResolvedValue({ chatId: "c", messageId: "x" });
    const item: OutboxItem = { kind: "text", chatId: "c", text: longText };
    await sendOutbound(plugin(sendText), {}, item, { chunks: 2, attachments: 0 });
    // Only the third chunk is re-sent; the first two are not delivered twice.
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText.mock.calls[0]?.[2]).toBe("cccccccccc");
  });

  it("throws the original error when nothing landed", async () => {
    const sendText = vi.fn().mockRejectedValue(new Error("socket closed"));
    const item: OutboxItem = { kind: "text", chatId: "c", text: "short" };
    await expect(sendOutbound(plugin(sendText), {}, item)).rejects.not.toBeInstanceOf(PartialSendError);
  });

  it("does not re-send attachments that already went out", async () => {
    const sendText = vi.fn().mockResolvedValue({ chatId: "c", messageId: "x" });
    const sendMedia = vi.fn().mockResolvedValue({ chatId: "c", messageId: "m" });
    const item: OutboxItem = {
      kind: "result",
      chatId: "c",
      status: "completed",
      result: "done",
      attachments: [
        { fileName: "a.pdf", mimeType: "application/pdf", data: Buffer.from("a").toString("base64") },
        { fileName: "b.pdf", mimeType: "application/pdf", data: Buffer.from("b").toString("base64") },
      ],
    };
    await sendOutbound(plugin(sendText, sendMedia), {}, item, { chunks: 1, attachments: 1 });
    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(sendMedia.mock.calls[0]?.[2]).toMatchObject({ fileName: "b.pdf" });
  });
});

describe("a completed run with nothing to say", () => {
  const item = (over: Record<string, unknown> = {}) =>
    ({ kind: "result", chatId: "c", status: "completed", result: "", ...over }) as never;

  it("says something useful instead of a shrug", async () => {
    const sendText = vi.fn().mockResolvedValue({ chatId: "c", messageId: "x" });
    await sendOutbound(plugin(sendText), {}, item());
    const sent = sendText.mock.calls.map((c) => c[2]).join(" ");
    expect(sent).toContain("send /new to start fresh");
  });

  it("stays quiet when the files are the answer", async () => {
    const sendText = vi.fn().mockResolvedValue({ chatId: "c", messageId: "x" });
    const sendMedia = vi.fn().mockResolvedValue({ chatId: "c", messageId: "m" });
    await sendOutbound(plugin(sendText, sendMedia), {}, item({
      attachments: [{ fileName: "summary.pdf", mimeType: "application/pdf", data: Buffer.from("a").toString("base64") }],
    }));
    expect(sendText).not.toHaveBeenCalled();
    expect(sendMedia).toHaveBeenCalledTimes(1);
  });

  it("still reports a failed run as a failure, not as silence", async () => {
    const sendText = vi.fn().mockResolvedValue({ chatId: "c", messageId: "x" });
    await sendOutbound(plugin(sendText), {}, item({ status: "failed" }));
    const sent = sendText.mock.calls.map((c) => c[2]).join(" ");
    expect(sent).toContain("couldn't complete");
  });
});

describe("attachments that cannot be sent", () => {
  const result = (attachments: unknown[]) =>
    ({ kind: "result", chatId: "c", status: "completed", result: "here you go", attachments }) as never;

  it("says a file came through empty, not that it was too large", async () => {
    const sendText = vi.fn().mockResolvedValue({ chatId: "c", messageId: "x" });
    const sendMedia = vi.fn();
    await sendOutbound(plugin(sendText, sendMedia), {}, result([
      { fileName: "report.html", mimeType: "text/html", data: "" },
    ]));
    const sent = sendText.mock.calls.map((c) => c[2]).join(" ");
    expect(sent).toContain("came through empty");
    expect(sent).not.toContain("Too large");
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("still reports a genuinely oversized file as too large", async () => {
    const sendText = vi.fn().mockResolvedValue({ chatId: "c", messageId: "x" });
    const big = Buffer.alloc(200).toString("base64");
    const small = {
      capabilities: { maxTextChars: 20, media: true, typing: false, reactions: false, groups: true, maxFileBytes: 10 },
      sendText,
      sendMedia: vi.fn(),
      formatText: (t: string) => t,
    };
    await sendOutbound(small as never, {}, result([
      { fileName: "huge.pdf", mimeType: "application/pdf", data: big },
    ]));
    const sent = sendText.mock.calls.map((c) => c[2]).join(" ");
    expect(sent).toContain("Too large to send here");
  });
});

describe("typing while several runs share a chat", () => {
  const result = (over: Record<string, unknown> = {}) =>
    ({ kind: "result", chatId: "c", status: "completed", result: "done", ...over }) as never;

  const withTyping = (setTyping: ReturnType<typeof vi.fn>) =>
    ({
      capabilities: { maxTextChars: 4000, media: true, typing: true, reactions: false, groups: true },
      sendText: vi.fn().mockResolvedValue({ chatId: "c", messageId: "x" }),
      setTyping,
      formatText: (t: string) => t,
    }) as never;

  it("leaves the indicator alone while another run is still working", async () => {
    const setTyping = vi.fn().mockResolvedValue(undefined);
    await sendOutbound(withTyping(setTyping), {}, result({ stopTyping: false }));
    expect(setTyping).not.toHaveBeenCalled();
  });

  it("turns it off when it was the last one out", async () => {
    const setTyping = vi.fn().mockResolvedValue(undefined);
    await sendOutbound(withTyping(setTyping), {}, result({ stopTyping: true }));
    expect(setTyping).toHaveBeenCalledWith({}, "c", false);
  });

  it("still stops for an item that carries no decision at all", async () => {
    // Older queued items predate the field; stopping is the safe default.
    const setTyping = vi.fn().mockResolvedValue(undefined);
    await sendOutbound(withTyping(setTyping), {}, result());
    expect(setTyping).toHaveBeenCalledWith({}, "c", false);
  });
});
