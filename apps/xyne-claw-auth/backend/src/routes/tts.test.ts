import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  config: {
    azureTtsEndpoint: "https://azure.example.test",
    azureTtsApiKey: "azure-secret",
    azureTtsApiVersion: "2025-03-01-preview",
    azureTtsDeployment: "gpt-4o-mini-tts",
    azureTtsVoice: "shimmer",
  },
}));

vi.mock("../config.js", () => ({ CONFIG: state.config }));

async function postTts(body: Record<string, unknown>): Promise<{
  status: number;
  body: Record<string, unknown>;
}> {
  const { ttsRouter } = await import("./tts.js");
  return await new Promise((resolve, reject) => {
    let statusCode = 200;
    const req = {
      method: "POST",
      url: "/",
      originalUrl: "/",
      baseUrl: "",
      headers: {},
      body,
    } as unknown as Request;
    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json(payload: Record<string, unknown>) {
        resolve({ status: statusCode, body: payload });
        return this;
      },
    } as unknown as Response;
    (
      ttsRouter as unknown as {
        handle: (request: Request, response: Response, next: (error?: unknown) => void) => void;
      }
    ).handle(req, res, (error?: unknown) => {
      if (error) reject(error);
      else resolve({ status: 404, body: {} });
    });
  });
}

describe("POST /internal/tts", () => {
  beforeEach(() => {
    state.config.azureTtsEndpoint = "https://azure.example.test";
    state.config.azureTtsApiKey = "azure-secret";
    state.config.azureTtsApiVersion = "2025-03-01-preview";
    state.config.azureTtsDeployment = "gpt-4o-mini-tts";
    state.config.azureTtsVoice = "shimmer";
    vi.restoreAllMocks();
  });

  it("validates text before calling Azure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const empty = await postTts({ text: "" });
    const tooLong = await postTts({ text: "x".repeat(2_001) });

    expect(empty.status).toBe(400);
    expect(tooLong.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 503 when Azure TTS configuration is absent", async () => {
    state.config.azureTtsApiKey = "";

    const result = await postTts({ text: "Hello" });

    expect(result.status).toBe(503);
    expect(result.body).toEqual({
      success: false,
      error: expect.stringContaining("Azure TTS is not configured"),
    });
  });

  it("forwards the Azure OpenAI speech request and returns base64 audio", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );

    const result = await postTts({ text: "Safe narration", voice: "alloy" });

    expect(result).toEqual({
      status: 200,
      body: {
        success: true,
        data: { audioBase64: "AQID", mimeType: "audio/mpeg" },
      },
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe(
      "https://azure.example.test/openai/deployments/gpt-4o-mini-tts/audio/speech?api-version=2025-03-01-preview",
    );
    expect(init?.headers).toMatchObject({
      "content-type": "application/json",
      "api-key": "azure-secret",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "gpt-4o-mini-tts",
      input: "Safe narration",
      voice: "alloy",
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("uses the configured default voice and hides Azure response content on failure", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("provider details that must not be reflected", { status: 429 }),
    );

    const result = await postTts({ text: "Narration" });

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body))).toMatchObject({
      voice: "shimmer",
    });
    expect(result).toEqual({
      status: 502,
      body: { success: false, error: "Azure TTS request failed with status 429." },
    });
  });
});
