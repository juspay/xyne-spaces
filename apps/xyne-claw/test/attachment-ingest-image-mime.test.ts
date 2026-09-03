import { describe, expect, it } from "vitest";

import { ingestAttachments } from "../src/attachment-ingest.js";

const b64 = (s: string): string => Buffer.from(s).toString("base64");

/**
 * An unsupported image media type (image/svg+xml) must NEVER reach the LLM as an
 * image block: providers 400 the whole request on the media type, and once the
 * block is in the persisted history every retry/fallback re-sends it and 400s
 * too, poisoning the thread (prod 2026-08-24). SVG is XML text, so it is
 * surfaced as a readable text attachment instead; supported raster types still
 * flow through as images.
 */
describe("ingestAttachments image media-type gating", () => {
  it("keeps a PNG as a model image", async () => {
    const r = await ingestAttachments(
      [{ fileName: "diagram.png", mimeType: "image/png", data: b64("PNGDATA") }],
      () => {},
    );
    expect(r.imageAttachments.map((a) => a.fileName)).toEqual(["diagram.png"]);
  });

  it("does NOT send an SVG as an image, and surfaces its markup as text", async () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>';
    const r = await ingestAttachments(
      [{ fileName: "agent-sandbox.svg", mimeType: "image/svg+xml", data: b64(svg) }],
      () => {},
    );
    expect(r.imageAttachments).toEqual([]);
    const asText = r.textAttachments.find((t) => t.fileName === "agent-sandbox.svg");
    expect(asText?.content).toContain("<svg");
    expect(asText?.mimeType).toBe("text/plain");
  });

  it("drops an unsupported raster image (bmp) rather than sending it", async () => {
    const dropped: string[] = [];
    const r = await ingestAttachments(
      [{ fileName: "old.bmp", mimeType: "image/bmp", data: b64("BMPDATA") }],
      (m) => dropped.push(m),
    );
    expect(r.imageAttachments).toEqual([]);
    expect(r.textAttachments.map((t) => t.fileName)).not.toContain("old.bmp");
    expect(dropped.some((m) => /old\.bmp/.test(m) && /unsupported/i.test(m))).toBe(true);
  });

  it("partitions a mixed batch: png → image, svg → text", async () => {
    const r = await ingestAttachments(
      [
        { fileName: "ok.png", mimeType: "image/png", data: b64("PNG") },
        { fileName: "bad.svg", mimeType: "image/svg+xml", data: b64("<svg/>") },
      ],
      () => {},
    );
    expect(r.imageAttachments.map((a) => a.fileName)).toEqual(["ok.png"]);
    expect(r.textAttachments.map((t) => t.fileName)).toContain("bad.svg");
  });
});
