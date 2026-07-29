import { CONFIG } from "../config.js";

const TTS_TIMEOUT_MS = 30_000;

export class TtsServiceError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
    this.name = "TtsServiceError";
  }
}

function assertConfigured(): void {
  if (
    !CONFIG.azureTtsEndpoint ||
    !CONFIG.azureTtsApiKey ||
    !CONFIG.azureTtsApiVersion ||
    !CONFIG.azureTtsDeployment
  ) {
    throw new TtsServiceError(
      "Azure TTS is not configured; set AZURE_TTS_ENDPOINT, AZURE_TTS_API_KEY, AZURE_TTS_API_VERSION, and AZURE_TTS_DEPLOYMENT.",
      503,
    );
  }
}

export interface SynthesizedSpeech {
  audioBase64: string;
  mimeType: "audio/mpeg";
}

export async function synthesizeSpeech(text: string, voice?: string): Promise<SynthesizedSpeech> {
  assertConfigured();
  const url =
    `${CONFIG.azureTtsEndpoint}/openai/deployments/` +
    `${encodeURIComponent(CONFIG.azureTtsDeployment)}/audio/speech?api-version=` +
    encodeURIComponent(CONFIG.azureTtsApiVersion);

  let response: globalThis.Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": CONFIG.azureTtsApiKey,
      },
      body: JSON.stringify({
        model: CONFIG.azureTtsDeployment,
        input: text,
        voice: voice || CONFIG.azureTtsVoice,
      }),
      signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
      throw new TtsServiceError("Azure TTS request timed out after 30 seconds.", 504);
    }
    throw new TtsServiceError("Azure TTS service is unavailable.", 502);
  }

  if (!response.ok) {
    throw new TtsServiceError(
      `Azure TTS request failed with status ${response.status}.`,
      502,
    );
  }

  const audio = Buffer.from(await response.arrayBuffer());
  return {
    audioBase64: audio.toString("base64"),
    mimeType: "audio/mpeg",
  };
}
