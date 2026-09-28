import { apiInstance } from '../clients/apiClient';

export interface SynthesizedSpeech {
  audioBase64: string;
  mimeType: string;
}

class TtsService {
  async synthesize(text: string, voice?: string): Promise<SynthesizedSpeech> {
    const response = await apiInstance.post('/tts', {
      text,
      ...(voice ? { voice } : {}),
    });
    const json = response.data as { success: boolean; data?: SynthesizedSpeech; error?: string };
    if (!json.success || !json.data) {
      throw new Error(json.error || 'TTS synthesis failed');
    }
    return json.data;
  }
}

export const ttsService = new TtsService();
