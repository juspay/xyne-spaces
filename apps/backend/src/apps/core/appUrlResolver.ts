import { config } from '@/config/env';
import { AppType } from '@xyne/shared';
import { logger } from '@/utils/logger';
import { assertWebhookUrlSafe } from '@/utils/ssrfGuard';

export interface ResolvedAppWebhook {
  url: string;
  isInternal: boolean;
}

/**
 * Resolve an app's dispatch URL. INTERNAL apps are rewritten to their in-cluster
 * pod URL (host from config.apps.internalHostMap); EXTERNAL apps pass through.
 * Falls back to the external URL when the host is unmapped.
 */
export function resolveAppWebhookUrl(
  appType: string | null | undefined,
  webhookUrl: string,
): ResolvedAppWebhook {
  if (appType !== AppType.INTERNAL) {
    return { url: webhookUrl, isInternal: false };
  }

  let parsed: URL;
  try {
    parsed = new URL(webhookUrl);
  } catch {
    throw new Error(`[APP-URL-RESOLVER] INTERNAL app has an invalid webhook URL: ${webhookUrl}`);
  }

  const host = parsed.hostname.toLowerCase();
  const internalBase = config.apps.internalHostMap[host];
  if (!internalBase) {
    logger.warn(
      `[APP-URL-RESOLVER] INTERNAL app host "${host}" is not in the internal host map; falling back to the stored external webhookUrl`,
    );
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
 * Resolve + guard an outbound app-webhook dispatch. INTERNAL apps skip the SSRF
 * guard (host from trusted config) and get the S2S key; EXTERNAL apps run the
 * guard. Caller MUST pass `redirect: 'manual'` on its fetch.
 */
export async function prepareAppWebhookDispatch(
  appType: string | null | undefined,
  webhookUrl: string,
  headers: Record<string, string> = {},
): Promise<{ url: string; headers: Record<string, string>; isInternal: boolean }> {
  const { url, isInternal } = resolveAppWebhookUrl(appType, webhookUrl);
  if (isInternal) {
    const s2sKey = config.internalS2sKey;
    if (s2sKey) {
      headers['x-s2s-key'] = s2sKey;
    } else {
      logger.warn(
        '[APP-URL-RESOLVER] INTERNAL app dispatch but INTERNAL_S2S_KEY is unset; sending without S2S auth',
      );
    }
  } else {
    await assertWebhookUrlSafe(url);
  }
  return { url, headers, isInternal };
}
