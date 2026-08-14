import axios from 'axios';
import FormData from 'form-data';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

interface PythonTranscriptionResponse {
  text: string;
  language?: string;
  duration_s?: number;
}

interface RecordingRepairTranscriptionResponse extends PythonTranscriptionResponse {
  speech_detected: boolean;
  speech_duration_s: number;
  audio_duration_s: number;
}

export class VoiceInputService {
  async transcribeRecordingRepair(
    file: Express.Multer.File,
    offsets: { startOffsetMs: number; endOffsetMs: number },
  ): Promise<{
    text: string;
    language?: string;
    speechDetected: boolean;
    speechDurationSeconds: number;
    audioDurationSeconds: number;
  }> {
    const pythonAgentUrl = config.pythonAgentUrl;
    if (!pythonAgentUrl) throw new Error('PYTHON_AGENT_URL is not configured');

    const form = new FormData();
    form.append('audio', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    form.append('startOffsetMs', String(offsets.startOffsetMs));
    form.append('endOffsetMs', String(offsets.endOffsetMs));

    const startedAt = Date.now();
    try {
      const response = await axios.post<RecordingRepairTranscriptionResponse>(
        `${pythonAgentUrl}/transcribe-recording-repair`,
        form,
        { headers: form.getHeaders(), timeout: 60_000 },
      );
      logger.info('[VoiceInputService] Recording repair VAD/STT completed', {
        elapsedMs: Date.now() - startedAt,
        sizeBytes: file.size,
        speechDetected: response.data.speech_detected,
        speechDurationSeconds: response.data.speech_duration_s,
        audioDurationSeconds: response.data.audio_duration_s,
        chars: response.data.text?.length ?? 0,
      });
      return {
        text: response.data.text ?? '',
        language: response.data.language,
        speechDetected: response.data.speech_detected,
        speechDurationSeconds: response.data.speech_duration_s,
        audioDurationSeconds: response.data.audio_duration_s,
      };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const body = error.response?.data as { error?: string } | undefined;
        throw new Error(`Recording repair transcription error: ${body?.error || error.message}`);
      }
      throw error;
    }
  }

  async transcribeAudio(
    file: Express.Multer.File,
    options?: {
      language?: string;
      hints?: string[];
    },
  ): Promise<PythonTranscriptionResponse> {
    const pythonAgentUrl = config.pythonAgentUrl;
    if (!pythonAgentUrl) {
      throw new Error('PYTHON_AGENT_URL is not configured');
    }

    const form = new FormData();
    form.append('audio', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });

    if (options?.language) {
      form.append('language', options.language);
    }

    if (options?.hints && options.hints.length > 0) {
      form.append('hints', JSON.stringify(options.hints));
    }

    logger.info(
      `[VoiceInputService] Forwarding to Python agent | url=${pythonAgentUrl}/transcribe-audio` +
        ` | size=${(file.size / 1024).toFixed(1)}KB | mime=${file.mimetype}` +
        ` | language=${options?.language ?? '(default)'} | hints=${options?.hints?.length ?? 0}`,
    );
    const _t0 = Date.now();

    try {
      const response = await axios.post<PythonTranscriptionResponse>(
        `${pythonAgentUrl}/transcribe-audio`,
        form,
        {
          headers: form.getHeaders(),
          timeout: 60_000,
        },
      );

      const elapsed = Date.now() - _t0;
      logger.info(
        `[VoiceInputService] Python agent responded | status=${response.status}` +
          ` | elapsed=${elapsed}ms | chars=${response.data.text?.length ?? 0}` +
          ` | language=${response.data.language ?? 'unknown'}`,
      );
      return response.data;
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data as { error?: string } | undefined;

        if (status === 404) {
          const message =
            'Transcription service unavailable — ensure the transcription agent is running (PYTHON_AGENT_URL)';
          logger.error(`[VoiceInputService] ${message}`);
          throw new Error(message);
        }

        const message = body?.error || error.message;
        logger.error(
          `[VoiceInputService] Python transcription failed | status=${status ?? 'unknown'} | error=${message}`,
        );
        throw new Error(`Transcription service error: ${message}`);
      }

      logger.error('[VoiceInputService] Unexpected transcription error:', error);
      throw error;
    }
  }
}

export const voiceInputService = new VoiceInputService();
