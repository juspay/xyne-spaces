import { config } from '@/config/env';
import { logger } from '@/utils/logger';
import { assertWebhookUrlSafe } from '@/utils/ssrfGuard';

export interface ResolvedAppWebhook {
  url: string;
  isInternal: boolean;
}

/**
 * Resolve an app's dispatch URL. If the webhookUrl's host is present in the
 * internal host map (config.apps.internalHostMap, parsed from the
 * INTERNAL_APP_HOST_MAP stringified-JSON env var), rewrite it to the in-cluster
 * pod URL; otherwise pass the stored webhookUrl through unchanged.
 */
export function resolveAppWebhookUrl(webhookUrl: string): ResolvedAppWebhook {
  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error(`[APP-URL-RESOLVER] Invalid webhook URL: ${webhookUrl}`);
  }

  const host = parsed.hostname.toLowerCase();
  const internalBase = config.apps.internalHostMap[host];
  if (!internalBase) {
    return { url: webhookUrl, isInternal: false };
  }

  const resolved = `${internalBase}${parsed.pathname}${parsed.search}${parsed.hash}`;
  logger.debug('[APP-URL-RESOLVER] Resolved internal app webhook', {
    externalHost: host,
    resolvedUrl: resolved,
  });
  return { url: resolved, isInternal: true };
}

/**
 * Resolve + guard an outbound app-webhook dispatch. If the host maps to an
 * internal pod URL, skip the SSRF guard (host from trusted config) and attach
 * the S2S key; otherwise run the SSRF guard. Caller MUST pass `redirect:
 * 'manual'` on its fetch.
 */
export async function prepareAppWebhookDispatch(
  webhookUrl: string,
  headers: Record<string, string> = {},
): Promise<{ url: string; headers: Record<string, string>; isInternal: boolean }> {
  const { url, isInternal } = resolveAppWebhookUrl(webhookUrl);
  if (!isInternal) {
    await assertWebhookUrlSafe(url);
  }
  return { url, headers, isInternal };
}
