/**
 * Builds the OTLP metrics URL. An empty override must not win over the default
 * host: `??` only treats null/undefined as missing, so `''` would otherwise
 * produce the invalid relative path `/godel/v1/metrics`.
 */
export function resolveMetricsEndpoint(
  override: string | undefined,
  fallbackBaseUrl: string,
): string {
  const trimmedOverride = (override ?? '').trim().replace(/\/$/, '');
  const baseUrl = (trimmedOverride.length > 0 ? trimmedOverride : fallbackBaseUrl.trim()).replace(
    /\/$/,
    '',
  );

  return `${baseUrl}/godel/v1/metrics`;
}
