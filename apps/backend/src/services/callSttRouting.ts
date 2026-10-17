import { superpositionClient } from '@/services/superpositionClient';
import { logger } from '@/utils/logger';

/**
 * Which speech-to-text runs for a call, decided when the call's LiveKit room is created and
 * carried to the transcription agent and every client in the room metadata.
 *
 * - CAC `call_stt_neurolink_enabled`: NeuroLink is the STT people see (transcript + live
 *   captions); otherwise the existing provider is.
 * - CAC `call_stt_eval_enabled`: the other STT runs in parallel on the same audio without
 *   being shown, and both transcripts are sent to NeuroLink for evaluation.
 *
 * Both default to false, so calls behave exactly as before until a flag is turned on. The
 * agent ignores a NeuroLink model when NeuroLink is not configured on its side.
 *
 * - CAC `call_stt_neurolink_url`: the NeuroLink base URL for a workspace. The agent fetches it
 *   over its authenticated backend API (never via room metadata, which every client can read);
 *   empty means the agent's own NEUROLINK_STT_URL applies. The agent only uses a URL whose host
 *   is in its NEUROLINK_STT_ALLOWED_HOSTS, since it sends its token and transcripts there.
 *
 * The reads sit on the call-start path, so each is capped at FLAG_READ_TIMEOUT_MS; a slow or
 * failing flag service means the defaults (existing behaviour).
 */

const NEUROLINK_ENABLED_KEY = 'call_stt_neurolink_enabled';
const EVAL_ENABLED_KEY = 'call_stt_eval_enabled';
const NEUROLINK_URL_KEY = 'call_stt_neurolink_url';
const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:', 'ws:', 'wss:']);
const NEUROLINK_MODEL = 'neurolink';
/** The provider calls used before NeuroLink, when the caller doesn't pick one. */
const DEFAULT_STT_MODEL = 'google';
/** Providers a caller may pick; anything else gets the default. */
const EXISTING_STT_MODELS = new Set(['google', 'azure', 'deepgram']);
const FLAG_READ_TIMEOUT_MS = 1500;

export interface CallSttRouting {
  /** STT whose transcript is shown and stored. */
  sttModel: string;
  /** STT run in parallel for evaluation only; never shown. */
  sttShadowModel?: string;
  /** Clients show live captions for this call. */
  liveCaptions: boolean;
}

function withTimeout<T>(read: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${FLAG_READ_TIMEOUT_MS} ms`)), FLAG_READ_TIMEOUT_MS);
  });
  return Promise.race([read, timeout]).finally(() => clearTimeout(timer));
}

async function readFlag(key: string, context: Record<string, string>): Promise<boolean> {
  try {
    return await withTimeout(superpositionClient.getBooleanValue(key, false, context));
  } catch (error) {
    logger.error(`[CallSttRouting] Failed to read ${key}, defaulting to false:`, error);
    return false;
  }
}

/** NeuroLink base URL from CAC for a workspace, or null when unset or not an http(s)/ws(s) URL. */
export async function resolveNeuroLinkBaseUrl(params: {
  workspaceId?: string | null;
}): Promise<string | null> {
  let value = '';
  try {
    value = await withTimeout(
      superpositionClient.getStringValue(
        NEUROLINK_URL_KEY,
        '',
        params.workspaceId ? { workspaceId: params.workspaceId } : {},
      ),
    );
  } catch (error) {
    logger.error(`[CallSttRouting] Failed to read ${NEUROLINK_URL_KEY}:`, error);
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  try {
    const url = new URL(trimmed);
    if (!ALLOWED_URL_PROTOCOLS.has(url.protocol)) throw new Error(`protocol ${url.protocol}`);
    return trimmed.replace(/\/+$/, '');
  } catch (error) {
    logger.warn(`[CallSttRouting] Ignoring invalid ${NEUROLINK_URL_KEY}: ${(error as Error).message}`);
    return null;
  }
}

export async function resolveCallSttRouting(params: {
  requestedModel?: string | null;
  workspaceId?: string | null;
  email?: string | null;
}): Promise<CallSttRouting> {
  const context: Record<string, string> = {};
  if (params.workspaceId) context.workspaceId = params.workspaceId;
  if (params.email) context.email = params.email;

  const [neuroLinkEnabled, evalEnabled] = await Promise.all([
    readFlag(NEUROLINK_ENABLED_KEY, context),
    readFlag(EVAL_ENABLED_KEY, context),
  ]);

  // The existing provider: what the caller asked for when it is one, else the long-standing default
  const requested = params.requestedModel?.toLowerCase();
  const existingModel = requested && EXISTING_STT_MODELS.has(requested) ? requested : DEFAULT_STT_MODEL;

  if (neuroLinkEnabled) {
    return {
      sttModel: NEUROLINK_MODEL,
      ...(evalEnabled && { sttShadowModel: existingModel }),
      liveCaptions: true,
    };
  }

  return {
    sttModel: existingModel,
    ...(evalEnabled && { sttShadowModel: NEUROLINK_MODEL }),
    liveCaptions: false,
  };
}
