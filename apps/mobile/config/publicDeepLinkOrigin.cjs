const ENV_HINT =
  'Set PUBLIC_DEEP_LINK_ORIGIN (or EXPO_PUBLIC_PUBLIC_DEEP_LINK_ORIGIN) in .env.<variant>; ' +
  'see .env.example.';

/**
 * @param {string | undefined} raw
 * @returns {string}
 */
function resolvePublicDeepLinkOrigin(raw) {
  const candidate = (raw || '').trim();
  if (!candidate) {
    throw new Error(`[DeepLink] No public deep-link origin configured. ${ENV_HINT}`);
  }
  let parsed;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error(`[DeepLink] Invalid public origin: ${candidate}`);
  }

  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`[DeepLink] Public origin must be an HTTPS origin: ${candidate}`);
  }

  return parsed.origin;
}

function readConfiguredPublicDeepLinkOrigin() {
  // Lazy: variants.cjs is only needed here, and keeps this module loadable on its own.
  const { getPrebuildVariant } = require('./variants.cjs');
  return (
    process.env.EXPO_PUBLIC_PUBLIC_DEEP_LINK_ORIGIN ||
    process.env.PUBLIC_DEEP_LINK_ORIGIN ||
    getPrebuildVariant().defaultPublicDeepLinkOrigin ||
    ''
  );
}

/** Throws when nothing is configured: config plugins fail loudly rather than bake a wrong host. */
function getConfiguredPublicDeepLinkOrigin() {
  return resolvePublicDeepLinkOrigin(readConfiguredPublicDeepLinkOrigin());
}

/**
 * Tolerant variant for app.config.js (also evaluated by tooling that never prebuilds):
 * '' when unset. `expo prebuild` still fails in withDeepLinks.cjs.
 */
function getConfiguredPublicDeepLinkOriginOrEmpty() {
  const raw = readConfiguredPublicDeepLinkOrigin();
  return raw.trim() ? resolvePublicDeepLinkOrigin(raw) : '';
}

module.exports = {
  getConfiguredPublicDeepLinkOrigin,
  getConfiguredPublicDeepLinkOriginOrEmpty,
  resolvePublicDeepLinkOrigin,
};
