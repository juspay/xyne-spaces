export type MetricsDefaults = Readonly<{
  isDevBuild: boolean;
}>;

/**
 * Parses the build-time metrics flag from app.config.js `extra`.
 *
 * Default when unset: enabled for release builds and disabled for debug builds.
 */
export function parseMetricsEnabled(raw: string | undefined, defaults: MetricsDefaults): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();

  if (normalized === 'false') {
    return false;
  }

  if (normalized === 'true') {
    return true;
  }

  return !defaults.isDevBuild;
}
