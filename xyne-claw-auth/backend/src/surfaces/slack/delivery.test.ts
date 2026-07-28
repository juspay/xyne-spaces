import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  install: { encryptedBotToken: "encrypted:xoxb-token" } as Record<string, unknown> | null,
  warn: vi.fn(),
  postMessage: vi.fn(),
  filesUploadV2: vi.fn(),
  slackClient: vi.fn(),
}));

vi.mock("../../logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: mocks.warn, error: vi.fn() }),
}));

vi.mock("../../db.js", () => ({
  prisma: { surfaceAgentInstall: { findUnique: vi.fn(async () => mocks.install) } },
}));

vi.mock("../../lib/surface-resolver.js", () => ({
  decryptSurfaceSecret: vi.fn((value: string) => value.replace("encrypted:", "")),
}));

// Mocked at the surface's own API door rather than at `fetch`: these tests are
// about what we ask Slack to do, not how the SDK encodes it on the wire.
vi.mock("./api.js", () => ({
  slackClient: (token: string) => {
    mocks.slackClient(token);
    return { chat: { postMessage: mocks.postMessage }, filesUploadV2: mocks.filesUploadV2 };
  },
}));

import { deliverSlackResult, uploadSlackFiles } from "./delivery.js";
import { prepareSlackResultText } from "./mrkdwn.js";

const TARGET = {
  surfaceAgentId: "sa-1",
  teamId: "T123",
  channelId: "C123",
  threadTs: "100.01",
  slackUserId: "U123",
};

const attachment = (fileName: string, contents: string) => ({
  fileName,
  mimeType: "text/plain",
  data: Buffer.from(contents).toString("base64"),
});

describe("Slack result delivery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.postMessage.mockResolvedValue({ ok: true, ts: "101.01" });
    mocks.filesUploadV2.mockResolvedValue({ ok: true });
  });

  it("posts the converted result into the originating thread", async () => {
    const result = "## Answer\n**yes** [source](https://example.com)";
    await deliverSlackResult({ target: TARGET, status: "completed", result });

    expect(mocks.postMessage).toHaveBeenCalledWith({
      channel: "C123",
      thread_ts: "100.01",
      text: prepareSlackResultText(result),
    });
  });

  it("authenticates with the decrypted bot token for the install", async () => {
    await deliverSlackResult({ target: TARGET, status: "completed", result: "hi" });
    expect(mocks.slackClient).toHaveBeenCalledWith("xoxb-token");
  });

  it("posts a short failure message instead of the raw error", async () => {
    await deliverSlackResult({
      target: TARGET,
      status: "failed",
      result: "sensitive stack trace",
    });

    const [{ text }] = mocks.postMessage.mock.calls[0]!;
    expect(text).toContain("couldn't complete");
    expect(text).not.toContain("sensitive");
  });

  it("uploads result attachments into the same thread", async () => {
    await deliverSlackResult({
      target: TARGET,
      status: "completed",
      result: "report attached",
      attachments: [attachment("test.txt", "hello")],
    });

    expect(mocks.filesUploadV2).toHaveBeenCalledWith({
      channel_id: "C123",
      thread_ts: "100.01",
      file: Buffer.from("hello"),
      filename: "test.txt",
    });
  });

  it("does not upload attachments for a failed run", async () => {
    await deliverSlackResult({
      target: TARGET,
      status: "failed",
      result: "boom",
      attachments: [attachment("test.txt", "hello")],
    });

    expect(mocks.filesUploadV2).not.toHaveBeenCalled();
  });

  it("keeps uploading the remaining files after one fails", async () => {
    mocks.filesUploadV2
      .mockRejectedValueOnce(new Error("Slack files.completeUploadExternal failed: missing_scope"))
      .mockResolvedValueOnce({ ok: true });

    const result = await uploadSlackFiles("xoxb-secret", {
      channelId: "C123",
      attachments: [attachment("bad.txt", "one"), attachment("good.txt", "two")],
    });

    expect(result).toEqual({ uploaded: 1, failed: 1 });
  });

  it("logs the failing file name without leaking its contents or the token", async () => {
    mocks.filesUploadV2.mockRejectedValue(
      new Error("Slack files.completeUploadExternal failed: missing_scope"),
    );

    const result = await uploadSlackFiles("xoxb-secret", {
      channelId: "C123",
      attachments: [attachment("report.txt", "contents")],
    });

    expect(result).toEqual({ uploaded: 0, failed: 1 });
    expect(mocks.warn).toHaveBeenCalledWith("[slack-delivery] Slack file upload failed", {
      fileName: "report.txt",
      error: "Slack files.completeUploadExternal failed: missing_scope",
    });
    const logged = JSON.stringify(mocks.warn.mock.calls);
    expect(logged).not.toContain("contents");
    expect(logged).not.toContain("xoxb-secret");
  });

  it("rejects an oversized file before calling Slack", async () => {
    const oversized = {
      fileName: "huge.bin",
      mimeType: "application/octet-stream",
      data: Buffer.alloc(51 * 1024 * 1024).toString("base64"),
    };

    const result = await uploadSlackFiles("xoxb-secret", {
      channelId: "C123",
      attachments: [oversized],
    });

    expect(result).toEqual({ uploaded: 0, failed: 1 });
    expect(mocks.filesUploadV2).not.toHaveBeenCalled();
  });
});
