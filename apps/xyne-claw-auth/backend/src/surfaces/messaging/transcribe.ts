/**
 * Voice notes reach the agent as words, not bytes. Models do not read audio,
 * so a voice note without this is an empty message the agent answers blankly.
 *
 * The transcriber is the platform's own: the same Azure STT the Spaces voice
 * input uses, behind the python agent's /transcribe-audio. Spaces reaches it
 * through a user-session route we do not have here, so we call the service
 * directly, exactly as that route's proxy does.
 */
import { fetch as httpFetch, FormData } from "undici";
import { CONFIG } from "../../config.js";
import { errMsg } from "../../lib/errors.js";
import { createLogger } from "../../logger.js";

const log = createLogger("channel-transcribe");
const TIMEOUT_MS = 60_000;

export function transcriptionEnabled(): boolean {
  return !!CONFIG.pythonAgentUrl;
}

export function isAudio(mimeType: string): boolean {
  return mimeType.startsWith("audio/");
}

/** The spoken words, or "" when transcription is off, fails, or hears nothing.
 *  Never throws: a voice note we cannot read must not sink the message. */
export async function transcribeAudio(file: {
  fileName: string;
  mimeType: string;
  data: Buffer;
}): Promise<string> {
  if (!transcriptionEnabled()) return "";
  const form = new FormData();
  form.append("audio", new Blob([file.data], { type: file.mimeType }), file.fileName);
  try {
    const response = await httpFetch(`${CONFIG.pythonAgentUrl}/transcribe-audio`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) {
      log.warn(`[transcribe] HTTP ${response.status}`);
      return "";
    }
    const body = (await response.json().catch(() => null)) as { text?: string } | null;
    return body?.text?.trim() ?? "";
  } catch (err) {
    log.warn(`[transcribe] failed: ${errMsg(err)}`);
    return "";
  }
}
