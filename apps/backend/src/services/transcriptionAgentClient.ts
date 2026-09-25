import axios from 'axios';
import { config } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Client for the Python transcription agent's recording endpoint.
 *
 * `POST {PYTHON_AGENT_URL}/transcribe-recording` takes a recording URL; the agent
 * downloads it, runs it through Google Speech-to-Text (BatchRecognize) and returns
 * the full transcript. The call is synchronous and can take minutes for long
 * recordings; callers are expected to be background workers (Bull), not user requests.
 */

export interface TranscribeRecordingRequest {
  jobId: string;
  recordingUrl: string;
  language?: string;
}

/** The agent returns the text plus which provider produced it. */
export interface TranscribeRecordingResponse {
  text: string;
  provider: string;
}

/** Error codes the agent returns in `{ error, code }` bodies. */
export type TranscriptionAgentErrorCode =
  | 'bad_request'
  | 'invalid_url'
  | 'too_large'
  | 'recording_unavailable'
  | 'unsupported_media'
  | 'download_failed'
  | 'transcription_failed'
  | 'agent_unsupported'
  | 'agent_unreachable'
  | 'unknown';

const PERMANENT_CODES: ReadonlySet<TranscriptionAgentErrorCode> = new Set([
  'bad_request',
  'invalid_url',
  'too_large',
  'recording_unavailable',
  'unsupported_media',
  'agent_unsupported',
]);

export class TranscriptionAgentError extends Error {
  readonly code: TranscriptionAgentErrorCode;
  /** true → retrying won't help (bad URL, recording gone, unsupported media). */
  readonly permanent: boolean;
  readonly status?: number;

  constructor(code: TranscriptionAgentErrorCode, message: string, status?: number) {
    super(message);
    this.name = 'TranscriptionAgentError';
    this.code = code;
    this.permanent = PERMANENT_CODES.has(code);
    this.status = status;
  }
}

/** Human-readable message for the UI, keyed by agent error code. */
export function describeTranscriptionAgentError(error: TranscriptionAgentError): string {
  switch (error.code) {
    case 'recording_unavailable':
      return 'The recording is no longer available from the telephony provider.';
    case 'too_large':
      return 'The recording is too large to transcribe.';
    case 'unsupported_media':
      return 'The recording format is not supported.';
    case 'invalid_url':
      return 'The recording URL is not allowed.';
    case 'agent_unsupported':
      return 'The transcription service does not support call recordings yet.';
    case 'agent_unreachable':
      return 'The transcription service is unreachable.';
    default:
      return error.message || 'Transcription failed.';
  }
}

// The agent waits up to 30 min on Google's batch operation (RECORDING_GOOGLE_BATCH_TIMEOUT_S);
// give it 2 min of headroom for download + upload so the agent times out first.
const DEFAULT_TIMEOUT_MS = 32 * 60_000;

export class TranscriptionAgentClient {
  constructor(private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS) {}

  async transcribeRecording(input: TranscribeRecordingRequest): Promise<TranscribeRecordingResponse> {
    const pythonAgentUrl = config.pythonAgentUrl;
    if (!pythonAgentUrl) {
      throw new TranscriptionAgentError('agent_unreachable', 'PYTHON_AGENT_URL is not configured');
    }

    const t0 = Date.now();
    logger.info(
      `[TranscriptionAgentClient] transcribe-recording start | jobId=${input.jobId}` +
        ` | host=${safeHost(input.recordingUrl)} | language=${input.language ?? '(default)'}`,
    );

    try {
      const response = await axios.post<TranscribeRecordingResponse>(
        `${pythonAgentUrl}/transcribe-recording`,
        { jobId: input.jobId, recordingUrl: input.recordingUrl, ...(input.language && { language: input.language }) },
        { headers: { 'Content-Type': 'application/json' }, timeout: this.timeoutMs },
      );

      const data = response.data;
      if (!data || typeof data.text !== 'string') {
        throw new TranscriptionAgentError('unknown', 'Transcription agent returned an unexpected response');
      }

      logger.info(
        `[TranscriptionAgentClient] transcribe-recording done | jobId=${input.jobId}` +
          ` | elapsed=${Date.now() - t0}ms | chars=${data.text.length}` +
          ` | provider=${data.provider ?? 'unknown'}`,
      );
      return { ...data, provider: data.provider || 'unknown' };
    } catch (error) {
      if (error instanceof TranscriptionAgentError) throw error;

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        const body = error.response?.data as { error?: string; code?: string } | undefined;
        const message = body?.error || error.message;

        if (status === 404) {
          // Old agent build without the endpoint. Retrying won't fix it.
          throw new TranscriptionAgentError('agent_unsupported', 'Transcription agent has no /transcribe-recording endpoint', status);
        }
        if (status === 400 || status === 422) {
          const code = isKnownCode(body?.code) ? body.code : status === 400 ? 'bad_request' : 'unknown';
          throw new TranscriptionAgentError(code, message, status);
        }
        if (status !== undefined) {
          const code = isKnownCode(body?.code) ? body.code : 'transcription_failed';
          throw new TranscriptionAgentError(code, message, status);
        }
        // No response at all: connection refused, DNS, timeout.
        throw new TranscriptionAgentError('agent_unreachable', message);
      }

      throw new TranscriptionAgentError('unknown', error instanceof Error ? error.message : String(error));
    }
  }
}

function isKnownCode(code: unknown): code is TranscriptionAgentErrorCode {
  return (
    typeof code === 'string' &&
    (PERMANENT_CODES.has(code as TranscriptionAgentErrorCode) ||
      code === 'download_failed' ||
      code === 'transcription_failed')
  );
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '(invalid)';
  }
}

export const transcriptionAgentClient = new TranscriptionAgentClient();
