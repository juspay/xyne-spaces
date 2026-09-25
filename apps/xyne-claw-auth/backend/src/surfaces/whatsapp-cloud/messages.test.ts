import { describe, expect, it } from "vitest";
import { parseCloudWebhook } from "./messages.js";

// The parser requires Meta's real envelope: object, field: "messages".
const wrap = (message: Record<string, unknown>) => ({
  object: "whatsapp_business_account",
  entry: [
    {
      changes: [
        {
          field: "messages",
          value: { contacts: [{ wa_id: "919", profile: { name: "Priya" } }], messages: [message] },
        },
      ],
    },
  ],
});

const base = { from: "919", id: "wamid.1", timestamp: "1700000000" };

describe("parseCloudWebhook media", () => {
  it("keeps a captionless photo instead of dropping it as empty", () => {
    // It used to be discarded here: no text, so nothing reached the agent.
    const [msg] = parseCloudWebhook(wrap({ ...base, type: "image", image: { id: "media-1", mime_type: "image/png" } }));
    expect(msg).toMatchObject({ messageId: "wamid.1", text: "" });
    expect(msg?.media).toEqual({ mediaId: "media-1", kind: "image", mimeType: "image/png", fileName: "image.jpg" });
  });

  it("carries a document's real filename and caption", () => {
    const [msg] = parseCloudWebhook(
      wrap({
        ...base,
        type: "document",
        document: { id: "media-2", mime_type: "application/pdf", filename: "invoice.pdf", caption: "have a look" },
      }),
    );
    expect(msg?.text).toBe("have a look");
    expect(msg?.media).toMatchObject({ mediaId: "media-2", kind: "document", fileName: "invoice.pdf" });
  });

  it("recognises a voice note", () => {
    const [msg] = parseCloudWebhook(
      wrap({ ...base, type: "audio", audio: { id: "media-3", mime_type: "audio/ogg; codecs=opus", voice: true } }),
    );
    expect(msg?.media).toMatchObject({ kind: "audio", mediaId: "media-3" });
  });

  it("falls back to sane defaults when Meta omits the mime type", () => {
    const [msg] = parseCloudWebhook(wrap({ ...base, type: "video", video: { id: "media-4" } }));
    expect(msg?.media).toMatchObject({ mimeType: "video/mp4", fileName: "video.mp4" });
  });

  it("still drops a message that carries nothing at all", () => {
    expect(parseCloudWebhook(wrap({ ...base, type: "text", text: { body: "  " } }))).toHaveLength(0);
    // A media node with no id is not a file we can ever fetch.
    expect(parseCloudWebhook(wrap({ ...base, type: "image", image: {} }))).toHaveLength(0);
  });

  it("leaves plain text untouched", () => {
    const [msg] = parseCloudWebhook(wrap({ ...base, type: "text", text: { body: "hello" } }));
    expect(msg?.text).toBe("hello");
    expect(msg?.media).toBeUndefined();
  });
});
