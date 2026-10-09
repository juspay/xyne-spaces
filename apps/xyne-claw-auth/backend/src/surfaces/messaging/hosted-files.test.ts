import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const store = new Map<string, string>();
vi.mock("../../redis.js", () => ({
  redisService: {
    getConnection: () => ({
      get: async (k: string) => store.get(k) ?? null,
      set: async (k: string, v: string) => {
        store.set(k, v);
        return "OK";
      },
    }),
  },
}));
vi.mock("../../config.js", () => ({ CONFIG: { selfUrl: "https://claw.test" } }));
const objects = new Map<string, Buffer>();
vi.mock("../../services/storageService.js", () => ({
  gcsService: {
    uploadFile: async (buffer: Buffer, path: string) => {
      objects.set(path, buffer);
    },
    getFileBuffer: async (path: string) => {
      const data = objects.get(path);
      if (!data) throw new Error("not found");
      return data;
    },
  },
}));
const enqueueOutbound = vi.fn(async (..._args: unknown[]) => undefined);
vi.mock("./delivery.js", () => ({ enqueueOutbound }));
let acceptsHtml = false;
vi.mock("./plugin.js", () => ({
  getChannel: () => ({
    capabilities: { media: true, maxFileBytes: 1_000 },
    acceptsFile: (mime: string) => mime !== "text/html" || acceptsHtml,
  }),
}));

const { hostFile, sendGeneratedFile, hostedFilesRouter } = await import("./hosted-files.js");

const target = { channel: "whatsapp-cloud", connectedSurfaceId: "acc", accountKey: "k", chatId: "919", senderId: "919", isGroup: false } as const;
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use("/claw/api/v1/surfaces/:channel", hostedFilesRouter);
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(() => {
  enqueueOutbound.mockClear();
  acceptsHtml = false;
});

describe("hosted files", () => {
  it("serves a parked file sandboxed, and refuses unknown links", async () => {
    const url = await hostFile({ channel: "whatsapp-cloud", fileName: "debug trace.html", mimeType: "text/html", data: Buffer.from("<h1>trace</h1>") });
    expect(url).toMatch(/^https:\/\/claw\.test\/claw\/api\/v1\/surfaces\/whatsapp-cloud\/files\/[A-Za-z0-9_-]{24}$/);
    const res = await fetch(url.replace("https://claw.test", base));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("content-security-policy")).toBe("sandbox allow-scripts allow-popups");
    expect(await res.text()).toBe("<h1>trace</h1>");
    expect((await fetch(`${base}/claw/api/v1/surfaces/whatsapp-cloud/files/${"x".repeat(24)}`)).status).toBe(410);
  });

  it("sends a file the chat takes as a document, and anything else as a link", async () => {
    await sendGeneratedFile(target, { fileName: "notes.pdf", mimeType: "application/pdf", content: Buffer.from("%PDF"), summary: "Findings" });
    expect(enqueueOutbound.mock.calls[0]?.[1]).toMatchObject({ kind: "file", caption: "Findings", attachment: { fileName: "notes.pdf" } });

    await sendGeneratedFile(target, { fileName: "debug.html", mimeType: "text/html", content: "<html/>", summary: "**Debug trace**" });
    const link = enqueueOutbound.mock.calls[1]?.[1] as { kind: string; text: string };
    expect(link.kind).toBe("text");
    expect(link.text).toMatch(/^\*\*Debug trace\*\*\n\nOpen it here \(link works for 7 days\): https:\/\/claw\.test\/.*\/files\//);

    // Over the size cap: a link too, even for an accepted type.
    await sendGeneratedFile(target, { fileName: "big.pdf", mimeType: "application/pdf", content: Buffer.alloc(2_000), summary: "Big" });
    expect((enqueueOutbound.mock.calls[2]?.[1] as { kind: string }).kind).toBe("text");
  });
});
