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

// Spoken lines repeat (Buddy's questions) and are synthesized ahead of time, so the audio is kept.
const CACHE_SIZE = 40;

class TtsService {
  // Keyed by voice and text. Holds the request, so a call made while one is in flight shares it;
  // Map order is insertion order, so the oldest entry goes first.
  private cache = new Map<string, Promise<SynthesizedSpeech>>();

  async voices(): Promise<TtsVoices> {
    return queryClient.fetchQuery(ttsVoicesQuery).catch(() => NO_VOICES);
  }

  synthesize(text: string, voice?: string): Promise<SynthesizedSpeech> {
    const key = `${voice ?? ''}|${text}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const request = this.request(text, voice);
    this.cache.set(key, request);
    const oldest = this.cache.keys().next().value;
    if (this.cache.size > CACHE_SIZE && oldest !== undefined) this.cache.delete(oldest);
    // A failure is not worth keeping: the next call tries again.
    request.catch(() => {
      if (this.cache.get(key) === request) this.cache.delete(key);
    });
    return request;
  }

  private async request(text: string, voice?: string): Promise<SynthesizedSpeech> {
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
