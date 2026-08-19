import { describe, expect, it } from "vitest";

import { ingestAttachments } from "../src/attachment-ingest.js";

describe("/record-skill attachment ingestion", () => {
  it("retains the raw recording and defers ffmpeg processing to the sandbox tool", async () => {
    const bytes = Buffer.from("fake-video-for-deferred-ingest");
    const result = await ingestAttachments(
      [{ fileName: "workflow.mp4", mimeType: "video/mp4", data: bytes.toString("base64") }],
      () => {},
      { deferVideoProcessing: true },
    );

    expect(result.videoBuffers).toHaveLength(1);
    expect(result.videoBuffers[0]?.fileName).toBe("workflow.mp4");
    expect(result.videoBuffers[0]?.buf.equals(bytes)).toBe(true);
    expect(result.videoKeyframes).toEqual([]);
    expect(result.videoAttachments).toHaveLength(1);
    expect(result.derivedContextFiles).toEqual([
      expect.objectContaining({
        path: "workflow.mp4.video.md",
        content: expect.stringContaining("analyze-skill-recording"),
      }),
    ]);
  });
});
