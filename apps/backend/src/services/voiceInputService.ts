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
  segments?: Array<{ start_s: number; end_s: number; text: string }>;
}

export class VoiceInputService {
  async transcribeRecordingRepair(
    file: Express.Multer.File,
    offsets?: { startOffsetMs: number; endOffsetMs: number }
  ): Promise<{
    text: string;
    language?: string;
    speechDetected: boolean;
    speechDurationSeconds: number;
    audioDurationSeconds: number;
    segments: Array<{ startSeconds: number; endSeconds: number; text: string }>;
  }> {
    const pythonAgentUrl = config.pythonAgentUrl;
    if (!pythonAgentUrl) throw new Error('PYTHON_AGENT_URL is not configured');

    const form = new FormData();
    form.append('audio', file.buffer, {
      filename: file.originalname,
      contentType: file.mimetype,
    });
    // Whole-file mode (offsets omitted): the agent decodes + VAD/STT the entire
    // recording. Offsets are retained only for callers that still trim a window.
    if (offsets) {
      form.append('startOffsetMs', String(offsets.startOffsetMs));
      form.append('endOffsetMs', String(offsets.endOffsetMs));
    }

    const startedAt = Date.now();
    try {
      const response = await axios.post<RecordingRepairTranscriptionResponse>(
        `${pythonAgentUrl}/transcribe-recording-repair`,
        form,
        // The repair worker owns retries and keeps its database lease alive while
        // this internal request runs. Do not abort an in-flight provider request
        // locally and accidentally bill the same interval twice.
        {
          headers: {
            ...form.getHeaders(),
            ...(config.transcriptionAgentApiKey
              ? { 'x-transcription-agent-key': config.transcriptionAgentApiKey }
              : {}),
          },
          timeout: 0,
        }
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
        segments: (response.data.segments ?? []).map((segment) => ({
          startSeconds: segment.start_s,
          endSeconds: segment.end_s,
          text: segment.text,
        })),
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
    }
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
        ` | language=${options?.language ?? '(default)'} | hints=${options?.hints?.length ?? 0}`
    );
    const _t0 = Date.now();

    try {
      const response = await axios.post<PythonTranscriptionResponse>(
        `${pythonAgentUrl}/transcribe-audio`,
        form,
        {
          headers: form.getHeaders(),
          timeout: 60_000,
        }
      );

      const elapsed = Date.now() - _t0;
      logger.info(
        `[VoiceInputService] Python agent responded | status=${response.status}` +
          ` | elapsed=${elapsed}ms | chars=${response.data.text?.length ?? 0}` +
          ` | language=${response.data.language ?? 'unknown'}`
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
          `[VoiceInputService] Python transcription failed | status=${status ?? 'unknown'} | error=${message}`
        );
        throw new Error(`Transcription service error: ${message}`);
      }

      logger.error('[VoiceInputService] Unexpected transcription error:', error);
      throw error;
    }
  }
}

export const voiceInputService = new VoiceInputService();
