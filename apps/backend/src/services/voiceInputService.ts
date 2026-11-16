import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { allowlistedFetch, createHttpClient, isHttpError } from '@/utils/ssrfGuard';

// Only the configured Python transcription agent.
const agentHttp = createHttpClient(allowlistedFetch(() => [config.pythonAgentUrl]));

interface PythonTranscriptionResponse {
  text: string;
  language?: string;
  duration_s?: number;
}

export class VoiceInputService {
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
    form.append('audio', new Blob([file.buffer], { type: file.mimetype }), file.originalname);

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
      const response = await agentHttp.post<PythonTranscriptionResponse>(
        `${pythonAgentUrl}/transcribe-audio`,
        form,
        { timeout: 60_000 },
      );

      const elapsed = Date.now() - _t0;
      logger.info(
        `[VoiceInputService] Python agent responded | status=${response.status}` +
          ` | elapsed=${elapsed}ms | chars=${response.data.text?.length ?? 0}` +
          ` | language=${response.data.language ?? 'unknown'}`,
      );
      return response.data;
    } catch (error) {
      if (isHttpError(error)) {
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
