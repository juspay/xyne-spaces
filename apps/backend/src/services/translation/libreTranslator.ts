import { config } from '@/config/env';
import { logger } from '@/utils/logger';

/**
 * Client for a self-hosted LibreTranslate instance — the `translation` profile service
 * in docker-compose.local.yml, loaded with the same languages as `SUPPORTED_LANGUAGES`
 * in languageCodes.ts. It takes plain ISO 639-1 codes directly for `source`/`target`,
 * which is already the format `Message.sourceLang` / `UserPreference.preferredLanguage`
 * are stored in — no code translation needed on this side.
 *
 * On a real 14-block message this measured ~3.4s end to end, vs. ~51s for an earlier
 * in-process NLLB model that this replaced entirely (see translateMessage.ts's
 * block-splitting comments for why block count matters to that number). The speed
 * comes from CTranslate2 + a small model per language pair, not a trick — this is the
 * same serving engine a dedicated production NLLB inference server would use anyway.
 */

const REQUEST_TIMEOUT_MS = 15_000;

export function isConfigured(): boolean {
  return !!config.libretranslateUrl;
}

/**
 * Translates one text fragment. Throws on any failure (network, timeout, unsupported
 * pair) — the caller (translateMessage.ts) doesn't catch this, so it propagates up to
 * the Bull job handler in translationQueue.ts, which fails the job and lets Bull's
 * configured retry/backoff handle it. There's no fallback translation backend.
 */
export async function translateTextLibre(
  text: string,
  sourceIso6391: string,
  targetIso6391: string,
): Promise<string> {
  const startedAt = Date.now();
  const res = await fetch(`${config.libretranslateUrl}/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ q: text, source: sourceIso6391, target: targetIso6391, format: 'text' }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[LibreTranslator] HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { translatedText?: string; error?: string };
  if (!data.translatedText) {
    throw new Error(`[LibreTranslator] No translatedText in response: ${JSON.stringify(data).slice(0, 200)}`);
  }

  logger.info('[LibreTranslator] Translated', {
    sourceIso6391,
    targetIso6391,
    tookMs: Date.now() - startedAt,
    inputChars: text.length,
  });

  return data.translatedText;
}
