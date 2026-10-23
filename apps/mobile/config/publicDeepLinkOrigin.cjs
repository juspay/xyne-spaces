const DEFAULT_PUBLIC_DEEP_LINK_ORIGIN = 'https://spaces.xyne.juspay.net';

/**
 * @param {string | undefined} raw
 * @returns {string}
 */
function resolvePublicDeepLinkOrigin(raw) {
  const candidate = (raw || '').trim() || DEFAULT_PUBLIC_DEEP_LINK_ORIGIN;
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

function getConfiguredPublicDeepLinkOrigin() {
  // Lazy: variants.cjs is only needed here, and keeps this module loadable on its own.
  const { getPrebuildVariant } = require('./variants.cjs');
  return resolvePublicDeepLinkOrigin(
    process.env.EXPO_PUBLIC_PUBLIC_DEEP_LINK_ORIGIN ||
      process.env.PUBLIC_DEEP_LINK_ORIGIN ||
      getPrebuildVariant().defaultPublicDeepLinkOrigin,
  );
}

module.exports = {
  DEFAULT_PUBLIC_DEEP_LINK_ORIGIN,
  getConfiguredPublicDeepLinkOrigin,
  resolvePublicDeepLinkOrigin,
};
