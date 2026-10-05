import { config } from '@/config/env';
import type { SynthesizedSpeechResult } from '@/services/clawAgentService';
import { defaultVoiceId } from '@/services/elevenLabsVoices';

// A sentence takes well under a second; past this, fall back to Azure rather than stall the reply.
const TTS_TIMEOUT_MS = 5_000;

export function isElevenLabsTtsConfigured(): boolean {
  return (
    config.tts.provider === 'elevenlabs' &&
    Boolean(config.elevenLabs.apiKey) &&
    Boolean(config.elevenLabs.ttsVoiceId)
  );
}

export async function synthesizeWithElevenLabs(
  text: string,
  voiceId: string = defaultVoiceId()
): Promise<SynthesizedSpeechResult> {
  const { apiKey, apiUrl, ttsModel } = config.elevenLabs;
  const url = `${apiUrl}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_64`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'xi-api-key': apiKey },
    body: JSON.stringify({ text, model_id: ttsModel }),
    signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`ElevenLabs TTS failed with status ${response.status}`);
  }
  const audio = Buffer.from(await response.arrayBuffer());
  return { audioBase64: audio.toString('base64'), mimeType: 'audio/mpeg' };
}
