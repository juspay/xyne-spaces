export type RemoteLoggingDefaults = Readonly<{
  isDevBuild: boolean;
  isProductionVariant: boolean;
}>;

/**
 * Parses the build-time remote-logging flag from app.config.js `extra`.
 *
 * Default when unset: enabled only for production **release** builds.
 */
export function parseRemoteLoggingEnabled(
  raw: string | undefined,
  defaults: RemoteLoggingDefaults,
): boolean {
  const normalized = (raw ?? '').trim().toLowerCase();

  if (normalized === 'false') {
    return false;
  }

  if (normalized === 'true') {
    return true;
  }

  return defaults.isProductionVariant && !defaults.isDevBuild;
}
