import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const fetchMock = vi.fn();
vi.mock("undici", async () => {
  const actual = await vi.importActual<typeof import("undici")>("undici");
  return { ...actual, fetch: fetchMock };
});
vi.mock("../../config.js", () => ({ CONFIG: { pythonAgentUrl: "http://agent:8080" } }));

const { isAudio, transcribeAudio, transcriptionEnabled } = await import("./transcribe.js");

const voice = { fileName: "audio.ogg", mimeType: "audio/ogg", data: Buffer.from("x") };

describe("transcribe", () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => vi.unstubAllEnvs());

  it("recognises audio mime types only", () => {
    expect(isAudio("audio/ogg")).toBe(true);
    expect(isAudio("image/jpeg")).toBe(false);
  });

  it("is enabled when the agent url is configured", () => {
    expect(transcriptionEnabled()).toBe(true);
  });

  it("returns the transcript", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "  book a cab  " }) });
    expect(await transcribeAudio(voice)).toBe("book a cab");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("http://agent:8080/transcribe-audio");
  });

  it("returns empty on a non-ok response", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });
    expect(await transcribeAudio(voice)).toBe("");
  });

  it("swallows a malformed response body", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => {
        throw new SyntaxError("not json");
      },
    });
    expect(await transcribeAudio(voice)).toBe("");
  });

  it("returns empty when nothing was heard", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ text: "   " }) });
    expect(await transcribeAudio(voice)).toBe("");
  });
});
