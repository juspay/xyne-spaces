import { Readable } from "node:stream";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// XYNE-65486 / C-9: attachments are served from the claw-auth origin with the
// uploader-declared mimeType. These tests drive the real router over HTTP and
// assert the response headers a browser would act on.

// agent-chat.ts pulls in config.ts, which hard-requires ENCRYPTION_KEY at
// module load. Set before the dynamic import in beforeAll.
process.env["ENCRYPTION_KEY"] ??= "00".repeat(32);

const BODY = "<html><body><script>parent.pwned=1</script>hi</body></html>";

const state = vi.hoisted(() => ({
  attachment: null as null | Record<string, unknown>,
  ranges: [] as Array<{ start?: number; end?: number } | undefined>,
}));

// The route module graph constructs a PrismaClient at import time; no DB is
// touched by these handlers, so a stub client is enough.
vi.mock("@prisma/client", () => {
  class PrismaClientKnownRequestError extends Error {}
  const Prisma = {
    sql: () => ({}),
    join: () => ({}),
    raw: () => ({}),
    empty: {},
    DbNull: null,
    JsonNull: null,
    AnyNull: null,
    PrismaClientKnownRequestError,
    TransactionIsolationLevel: {},
  };
  class PrismaClient {
    constructor() {
      return new Proxy(this, {
        get: (target, prop) => (prop in target ? (target as Record<PropertyKey, unknown>)[prop] : new Proxy(() => undefined, { get: () => vi.fn() })),
      });
    }
    $connect = vi.fn();
    $disconnect = vi.fn();
    $on = vi.fn();
    $use = vi.fn();
    $extends() {
      return this;
    }
  }
  return { Prisma, PrismaClient, default: { Prisma, PrismaClient } };
});

vi.mock("../repositories/index.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    chatAttachmentRepository: {
      findById: vi.fn(async () => state.attachment),
    },
  };
});

vi.mock("../services/storageService.js", () => ({
  gcsService: {
    createReadStream: vi.fn((_url: string, opts?: { start?: number; end?: number }) => {
      state.ranges.push(opts);
      const body = opts ? BODY.slice(opts.start ?? 0, (opts.end ?? BODY.length - 1) + 1) : BODY;
      return Readable.from([Buffer.from(body)]);
    }),
  },
}));

vi.mock("../middleware/agent-acl.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getRequesterId: (req: express.Request) => (req.headers["x-user-id"] as string | undefined) ?? null,
    isClawAdmin: vi.fn(async () => false),
  };
});

let baseUrl = "";
let server: ReturnType<express.Express["listen"]>;

beforeAll(async () => {
  const { agentChatRouter } = await import("./agent-chat.js");
  const app = express();
  app.use("/api/v1/agent-chat", agentChatRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/agent-chat`;
}, 60_000);

afterAll(() => {
  server?.close();
});

function setAttachment(mimeType: string, originalFilename = "report.html", extra: Record<string, unknown> = {}) {
  state.attachment = {
    id: "att_1",
    uploaderUserId: "user_1",
    mimeType,
    originalFilename,
    size: Buffer.byteLength(BODY),
    url: "gs://bucket/att_1",
    thumbnailUrl: null,
    ...extra,
  };
}

const get = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}/attachments/att_1/${path}`, { headers: { "x-user-id": "user_1", ...headers } });

describe("claw-auth attachment response headers", () => {
  beforeEach(() => {
    state.ranges = [];
  });

  describe.each(["download", "stream"])("/%s", (route) => {
    it.each(["text/html", "application/unknown", "application/xhtml+xml", "text/xml"])(
      "serves an HTML body declared as %s as an opaque nosniff attachment",
      async (mime) => {
        setAttachment(mime);
        const res = await get(route);
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBe("application/octet-stream");
        expect(res.headers.get("content-disposition")).toBe('attachment; filename="report.html"');
        expect(res.headers.get("x-content-type-options")).toBe("nosniff");
        expect(await res.text()).toBe(BODY); // content preserved for fetch()-based previews
      },
    );

    it("keeps allowlisted media inline", async () => {
      setAttachment("image/png", "shot.png");
      const res = await get(route);
      expect(res.headers.get("content-type")).toBe("image/png");
      expect(res.headers.get("content-disposition")).toBe('inline; filename="shot.png"');
      expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    });

    it("renders SVG inline only under a sandbox CSP", async () => {
      setAttachment("image/svg+xml", "d.svg");
      const res = await get(route);
      expect(res.headers.get("content-type")).toBe("image/svg+xml");
      expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; style-src 'unsafe-inline'; sandbox");
    });
  });

  it("/download keeps Content-Length and Cache-Control", async () => {
    setAttachment("application/pdf", "doc.pdf");
    const res = await get("download");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-length")).toBe(String(Buffer.byteLength(BODY)));
    expect(res.headers.get("cache-control")).toBe("private, max-age=3600");
  });

  it("/stream range requests still return 206 with safe headers", async () => {
    setAttachment("video/mp4", "clip.mp4");
    const res = await get("stream", { range: "bytes=0-9" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-range")).toBe(`bytes 0-9/${Buffer.byteLength(BODY)}`);
    expect(res.headers.get("content-length")).toBe("10");
    expect(res.headers.get("accept-ranges")).toBe("bytes");
    expect(res.headers.get("content-type")).toBe("video/mp4");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(state.ranges.at(-1)).toEqual({ start: 0, end: 9 });
  });

  it("/stream range on an HTML body is still an opaque download", async () => {
    setAttachment("text/html");
    const res = await get("stream", { range: "bytes=0-9" });
    expect(res.status).toBe(206);
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("/thumbnail sends nosniff", async () => {
    setAttachment("image/png", "shot.png", { thumbnailUrl: "gs://bucket/att_1_thumb" });
    const res = await get("thumbnail");
    expect(res.headers.get("content-type")).toBe("image/jpeg");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("still enforces the uploader/admin ACL", async () => {
    setAttachment("text/plain", "a.txt");
    const res = await get("download", { "x-user-id": "someone_else" });
    expect(res.status).toBe(403);
  });
});
