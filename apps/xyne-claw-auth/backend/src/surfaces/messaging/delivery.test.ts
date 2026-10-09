import { describe, expect, it, vi } from "vitest";

vi.mock("../../redis.js", () => ({ redisService: { getConnection: () => ({}) } }));
vi.mock("./commands.js", () => ({ forgetActiveRun: vi.fn() }));
const hostFile = vi.fn(async (input: { fileName: string }) => `https://claw.test/files/${input.fileName}`);
vi.mock("./hosted-files.js", () => ({ hostFile }));

const { sendOutbound, templateParam } = await import("./delivery.js");

class WindowClosed extends Error {}

function plugin(overrides: Record<string, unknown> = {}) {
  return {
    key: "whatsapp-cloud",
    capabilities: { groups: false, reactions: true, typing: true, media: true, maxTextChars: 4096 },
    sendText: vi.fn(async (_h: unknown, chatId: string) => ({ chatId, messageId: "m1" })),
    formatText: (text: string) => text.replace(/\*\*(.+?)\*\*/g, "*$1*"),
    ...overrides,
  } as never;
}

describe("sendOutbound", () => {
  it("strips citation markup from a run's answer before the messenger sees it", async () => {
    const p = plugin();
    await sendOutbound(p, {}, { kind: "result", chatId: "919", status: "completed", result: "**3** PRs failing [clf-toolu_01x#2]." });
    expect((p as unknown as { sendText: ReturnType<typeof vi.fn> }).sendText.mock.calls[0]?.[2]).toBe("*3* PRs failing.");
  });

  it("falls back to the template when the reply window is closed", async () => {
    const sendTemplate = vi.fn(async () => ({ chatId: "919", messageId: "tpl" }));
    const p = plugin({
      sendText: vi.fn(async () => {
        throw new WindowClosed("24h");
      }),
      sendTemplate,
      isReplyWindowClosed: (err: unknown) => err instanceof WindowClosed,
    });
    const reply = await sendOutbound(p, {}, { kind: "text", chatId: "919", text: "Standup in 10.\nRoom 4", template: { name: "xyne_update", language: "en" } });
    expect(reply).toEqual({ ok: true, ref: { chatId: "919", messageId: "tpl" }, viaTemplate: true });
    expect(sendTemplate).toHaveBeenCalledWith({}, "919", { name: "xyne_update", language: "en" }, ["Standup in 10. · Room 4"]);
  });

  it("does not fall back without a template, or for any other failure", async () => {
    const boom = new Error("rate limited");
    const p = plugin({
      sendText: vi.fn(async () => {
        throw boom;
      }),
      sendTemplate: vi.fn(),
      isReplyWindowClosed: (err: unknown) => err instanceof WindowClosed,
    });
    await expect(sendOutbound(p, {}, { kind: "text", chatId: "919", text: "hi", template: { name: "t", language: "en" } })).rejects.toThrow("rate limited");
  });

  it("never lets a typing failure fail the queue", async () => {
    const p = plugin({ setTyping: vi.fn(async () => { throw new Error("old message"); }) });
    await expect(sendOutbound(p, {}, { kind: "typing", chatId: "919", on: true, messageId: "wamid" })).resolves.toEqual({ ok: true });
  });
});

describe("long answers", () => {
  const sections = { maxWords: 100, maxSections: 5 };
  const section = (i: number, words: number) => `**Part ${i}**\n${Array.from({ length: words }, (_, w) => `w${w}`).join(" ")}`;

  it("go out one heading section per message while they fit the chat's budget", async () => {
    const sendMedia = vi.fn(async (_h: unknown, chatId: string, _file: unknown) => ({ chatId, messageId: "doc" }));
    const p = plugin({ sendMedia, capabilities: { groups: false, reactions: true, typing: true, media: true, maxTextChars: 4096, resultSections: sections } });
    const answer = [1, 2, 3].map((i) => section(i, 60)).join("\n\n") + " [clf-toolu_01x#2]";
    await sendOutbound(p, {}, { kind: "result", chatId: "919", status: "completed", result: answer });
    const texts = (p as unknown as { sendText: ReturnType<typeof vi.fn> }).sendText.mock.calls.map((c) => c[2] as string);
    expect(texts).toHaveLength(3);
    expect(texts[0]).toMatch(/^\*Part 1\*/);
    expect(texts.join(" ")).not.toContain("clf-");
    expect(sendMedia).not.toHaveBeenCalled();
  });

  it("past the whole budget, send the first sections and the full answer as a PDF", async () => {
    const sendMedia = vi.fn(async (_h: unknown, chatId: string, _file: unknown) => ({ chatId, messageId: "doc" }));
    const p = plugin({ sendMedia, capabilities: { groups: false, reactions: true, typing: true, media: true, maxTextChars: 4096, resultSections: sections } });
    const answer = Array.from({ length: 8 }, (_, i) => section(i + 1, 80)).join("\n\n");
    await sendOutbound(p, {}, { kind: "result", chatId: "919", status: "completed", result: answer });
    const texts = (p as unknown as { sendText: ReturnType<typeof vi.fn> }).sendText.mock.calls.map((c) => c[2] as string);
    expect(texts).toHaveLength(5);
    expect(texts[4]).toContain("Full answer in the attached file.");
    expect(sendMedia.mock.calls[0]?.[2]).toMatchObject({ fileName: "full-answer.pdf", mimeType: "application/pdf" });
  });
});

describe("attachments the chat refuses", () => {
  it("arrive as a link instead of an apology", async () => {
    const sendMedia = vi.fn(async (_h: unknown, chatId: string, _file: unknown) => ({ chatId, messageId: "doc" }));
    const p = plugin({ sendMedia, acceptsFile: (mime: string) => mime !== "text/html" });
    const html = { fileName: "design.html", mimeType: "text/html", data: Buffer.from("<html/>").toString("base64") };
    const pdf = { fileName: "notes.pdf", mimeType: "application/pdf", data: Buffer.from("%PDF").toString("base64") };
    await sendOutbound(p, {}, { kind: "result", chatId: "919", status: "completed", result: "Here you go", attachments: [html, pdf] });
    expect(sendMedia).toHaveBeenCalledTimes(1);
    expect(sendMedia.mock.calls[0]?.[2]).toMatchObject({ fileName: "notes.pdf" });
    const texts = (p as unknown as { sendText: ReturnType<typeof vi.fn> }).sendText.mock.calls.map((c) => c[2] as string);
    expect(texts.at(-1)).toBe("This one opens in your browser (links work for 7 days):\ndesign.html: https://claw.test/files/design.html");
  });
});

describe("templateParam", () => {
  it("flattens what a template parameter may not hold", () => {
    expect(templateParam("**Done**\n\n\tAll    good")).toBe("Done · All   good");
    expect(templateParam("x".repeat(2000))).toHaveLength(900);
  });
});
