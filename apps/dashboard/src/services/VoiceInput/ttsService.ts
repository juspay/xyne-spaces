import { apiInstance } from '../clients/apiClient';
import { queryClient } from '../clients/queryClient';

export interface SynthesizedSpeech {
  audioBase64: string;
  mimeType: string;
}

export interface TtsVoice {
  id: string;
  name: string;
  description: string;
}

export interface TtsVoices {
  /** Empty when the server has no voice to choose from. */
  voices: TtsVoice[];
  defaultVoiceId: string;
}

const NO_VOICES: TtsVoices = { voices: [], defaultVoiceId: '' };

/** The voices the server speaks with; they only change with its configuration. */
export const ttsVoicesQuery = {
  queryKey: ['tts-voices'],
  queryFn: async (): Promise<TtsVoices> => {
    const response = await apiInstance.get('/tts/voices');
    const json = response.data as { success: boolean; data?: TtsVoices };
    return json.success && json.data ? json.data : NO_VOICES;
  },
  staleTime: Infinity,
};

/** The saved voice if the server still offers it, otherwise its default; undefined when there are no voices. */
export const pickVoice = (
  catalog: TtsVoices | undefined,
  savedId: string | null,
): TtsVoice | undefined =>
  catalog?.voices.find(voice => voice.id === savedId) ??
  catalog?.voices.find(voice => voice.id === catalog.defaultVoiceId);

class TtsService {
  async voices(): Promise<TtsVoices> {
    return queryClient.fetchQuery(ttsVoicesQuery).catch(() => NO_VOICES);
  }

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
