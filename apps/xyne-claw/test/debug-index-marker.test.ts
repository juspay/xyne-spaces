import { describe, expect, it, vi } from "vitest";

const uploads = vi.hoisted(() => [] as Array<{ body: Buffer; path: string }>);
vi.mock("@xyne/storage", async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  createStorageService: () => ({
    uploadFileV2: vi.fn(async (body: Buffer, opts: { path: string }) => {
      if (!body || body.length === 0) throw new Error("File buffer is empty or invalid");
      uploads.push({ body, path: opts.path });
      return { path: opts.path };
    }),
  }),
}));

const { gcsPutDebugIndex } = await import("../src/storage.js");

describe("debug index marker", () => {
  it("writes a non-empty marker, so the storage client's empty-buffer guard no longer rejects it", async () => {
    expect(await gcsPutDebugIndex("_index/conv-1/123-run~store.json")).toBe(true);
    expect(uploads).toHaveLength(1);
    expect(uploads[0]!.path.endsWith("_index/conv-1/123-run~store.json")).toBe(true);
    expect(JSON.parse(uploads[0]!.body.toString())).toEqual({});
  });
});
