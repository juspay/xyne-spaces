import { AxiosResponse, isAxiosError } from 'axios';
import { apiInstance } from '../clients/apiClient';

interface VoiceInputResponse {
  success: boolean;
  text: string;
  language?: string;
  durationS?: number;
  error?: string;
}

class VoiceInputService {
  async transcribeAudio(params: {
    audioBlob: Blob;
    mimeType?: string;
    language?: string;
    hints?: string[];
  }): Promise<{ text: string; language?: string; durationS?: number }> {
    const mimeType = params.mimeType || params.audioBlob.type || 'audio/webm';
    const extension = mimeType.includes('ogg')
      ? 'ogg'
      : mimeType.includes('wav')
        ? 'wav'
        : mimeType.includes('mp4') || mimeType.includes('m4a')
          ? 'm4a'
          : 'webm';

    const file = new File([params.audioBlob], `voice-input.${extension}`, {
      type: mimeType,
    });

    const formData = new FormData();
    formData.append('audio', file);

    if (params.language) {
      formData.append('language', params.language);
    }

    if (params.hints && params.hints.length > 0) {
      formData.append('hints', JSON.stringify(params.hints));
    }

    const _blobSizeKB = (params.audioBlob.size / 1024).toFixed(1);
    console.info(
      `[VoiceInputService] Sending transcription request | size=${_blobSizeKB}KB` +
        ` | mime=${mimeType} | language=${params.language ?? '(default)'}` +
        ` | hints=${params.hints?.length ?? 0}`,
    );
    const _t0 = Date.now();

    try {
      const response: AxiosResponse<VoiceInputResponse> = await apiInstance.post(
        '/voice-input/transcribe',
        formData,
      );

      const elapsed = Date.now() - _t0;
      console.info(
        `[VoiceInputService] Transcription success | elapsed=${elapsed}ms` +
          ` | chars=${response.data.text?.length ?? 0} | language=${response.data.language ?? 'unknown'}`,
      );
      return {
        text: response.data.text || '',
        ...(response.data.language ? { language: response.data.language } : {}),
        ...(typeof response.data.durationS === 'number'
          ? { durationS: response.data.durationS }
          : {}),
      };
    } catch (error) {
      const elapsed = Date.now() - _t0;
      if (isAxiosError(error)) {
        // Surface the structured error message from the backend when available.
        const backendError =
          (error.response?.data as VoiceInputResponse | undefined)?.error || error.message;
        console.error(
          `[VoiceInputService] Transcription failed | elapsed=${elapsed}ms` +
            ` | status=${error.response?.status ?? 'network'} | error=${backendError}`,
        );
        throw new Error(backendError);
      }
      console.error(`[VoiceInputService] Unexpected error | elapsed=${elapsed}ms`, error);
      throw error;
    }
  }
}

export const voiceInputService = new VoiceInputService();
