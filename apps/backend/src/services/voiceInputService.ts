import axios from 'axios';
import FormData from 'form-data';
import { GoogleAuth } from 'google-auth-library';
import { GCSService } from '@xyne/storage';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

interface PythonTranscriptionResponse {
  text: string;
  language?: string;
  duration_s?: number;
}

// Google Speech-to-Text v2 BatchRecognize — see:
// https://cloud.google.com/speech-to-text/v2/docs/reference/rest/v2/projects.locations.recognizers/batchRecognize
interface GoogleBatchRecognizeOperation {
  name: string;
  done?: boolean;
  error?: { code: number; message: string };
  response?: {
    results?: Record<
      string,
      {
        transcript?: { results?: Array<{ alternatives?: Array<{ transcript?: string }> }> };
        error?: { message: string };
      }
    >;
  };
}

const GOOGLE_STT_POLL_INTERVAL_MS = 5_000;
// Ceiling for a single batch job — long calls take longer to process; tune once real call
// lengths/latency are measured against a live recording (see plan doc verification step).
const GOOGLE_STT_MAX_WAIT_MS = 20 * 60_000;

const googleAuth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });

async function getGoogleAccessToken(): Promise<string> {
  const client = await googleAuth.getClient();
  const { token } = await client.getAccessToken();
  if (!token) {
    throw new Error('Failed to obtain a Google Cloud access token (check ADC / GOOGLE_APPLICATION_CREDENTIALS)');
  }
  return token;
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

  /**
   * Transcribes a call recording via Google Speech-to-Text v2 BatchRecognize.
   *
   * Google's synchronous `recognize` RPC caps out at ~1 minute of audio, which doesn't fit
   * call recordings (can run 15-30+ min) — so this stages the audio in GCS (BatchRecognize
   * only accepts gs:// URIs, not inline bytes) and polls the resulting long-running operation.
   */
  async transcribeWithGoogleStt(
    audio: { buffer: Buffer; fileName: string; mimeType: string },
    opts?: { language?: string },
  ): Promise<{ text: string; language?: string }> {
    const { model, language, location, bucketName, projectId } = config.googleStt;
    if (!bucketName || !projectId) {
      throw new Error('Google STT is not configured (GOOGLE_STT_GCS_BUCKET_NAME / GCS_PROJECT_ID)');
    }

    const gcs = new GCSService({ projectId, bucketName });
    const gcsObjectPath = `stt-staging/${Date.now()}-${audio.fileName}`;
    const gcsUri = `gs://${bucketName}/${gcsObjectPath}`;

    logger.info(
      `[VoiceInputService] Staging recording to GCS for Google STT | uri=${gcsUri}` +
        ` | size=${(audio.buffer.length / 1024).toFixed(1)}KB | mime=${audio.mimeType}`,
    );
    await gcs.uploadFileV2(audio.buffer, { path: gcsObjectPath, contentType: audio.mimeType });

    const targetLanguage = opts?.language || language;
    const apiHost = `${location}-speech.googleapis.com`;
    const _t0 = Date.now();

    try {
      const token = await getGoogleAccessToken();
      const batchUrl = `https://${apiHost}/v2/projects/${projectId}/locations/${location}/recognizers/_:batchRecognize`;

      const { data: operation } = await axios.post<GoogleBatchRecognizeOperation>(
        batchUrl,
        {
          config: {
            autoDecodingConfig: {},
            languageCodes: [targetLanguage],
            model,
          },
          files: [{ uri: gcsUri }],
          recognitionOutputConfig: { inlineResponseConfig: {} },
        },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 30_000 },
      );

      logger.info(`[VoiceInputService] Google STT BatchRecognize started | operation=${operation.name}`);

      const finalOp = await this.pollGoogleOperation(operation.name, apiHost, token);
      const elapsed = Date.now() - _t0;

      if (finalOp.error) {
        throw new Error(`Google STT batch job failed: ${finalOp.error.message}`);
      }
      const fileResult = finalOp.response?.results?.[gcsUri];
      if (fileResult?.error) {
        throw new Error(`Google STT transcription error: ${fileResult.error.message}`);
      }

      const text = (fileResult?.transcript?.results ?? [])
        .map(r => r.alternatives?.[0]?.transcript ?? '')
        .filter(Boolean)
        .join(' ')
        .trim();

      logger.info(
        `[VoiceInputService] Google STT responded | elapsed=${elapsed}ms | chars=${text.length}`,
      );
      return { text, language: targetLanguage };
    } catch (error) {
      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data as { error?: { message?: string } } | undefined;
        const message = body?.error?.message || error.message;
        logger.error(`[VoiceInputService] Google STT failed | status=${status ?? 'unknown'} | error=${message}`);
        throw new Error(`Google transcription error: ${message}`);
      }
      logger.error('[VoiceInputService] Unexpected Google STT error:', error);
      throw error;
    } finally {
      // Best-effort cleanup of the staged recording — don't fail the request over it.
      gcs.deleteFile(gcsObjectPath).catch(err => {
        logger.warn(`[VoiceInputService] Failed to clean up GCS staging file: ${gcsObjectPath}`, err);
      });
    }
  }

  private async pollGoogleOperation(
    operationName: string,
    apiHost: string,
    token: string,
  ): Promise<GoogleBatchRecognizeOperation> {
    const deadline = Date.now() + GOOGLE_STT_MAX_WAIT_MS;
    const opUrl = `https://${apiHost}/v2/${operationName}`;

    while (Date.now() < deadline) {
      const { data } = await axios.get<GoogleBatchRecognizeOperation>(opUrl, {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 30_000,
      });
      if (data.done) {
        return data;
      }
      await new Promise(resolve => setTimeout(resolve, GOOGLE_STT_POLL_INTERVAL_MS));
    }
    throw new Error('Google STT batch job timed out');
  }
}

export const voiceInputService = new VoiceInputService();
