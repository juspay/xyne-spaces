/**
 * Lotus build variants — used by app.config.js (via createRequire) and native plugins.
 * Keep IDs aligned with Firebase (google-services / GoogleService-Info) and Sign-In clients.
 */

const path = require('path');

const ROOT = path.join(__dirname, '..');

/**
 * `community` is the separate public community app (own store listing, package and Firebase
 * project; also named "Xyne Spaces"); the other three are the main Xyne Spaces app.
 * @typedef {'dev' | 'prod' | 'sandbox' | 'community'} VariantKey
 */

/** @type {Record<VariantKey, {
 *   key: VariantKey,
 *   androidApplicationId: string,
 *   iosBundleIdentifier: string,
 *   displayName: string,
 *   googleSignInIosUrlScheme: string,
 *   googleSignInIosClientId: string,
 *   googleSignInWebClientId: string,
 *   googleServicesRelDir: string,
 *   usesCleartextTraffic: boolean,
 *   defaultPublicDeepLinkOrigin: string,
 *   defaultApiBaseUrl: string,
 *   androidReleaseStoreFile: string,
 *   androidReleaseKeyAlias: string,
 *   version?: string,
 *   iosBuildNumber?: string,
 *   androidVersionCode?: number,
 * }>} */
const VARIANTS = {
  dev: {
    key: 'dev',
    androidApplicationId: 'net.juspay.xyne.spaces',
    iosBundleIdentifier: 'net.juspay.xyne.spaces.native',
    displayName: 'Xyne Spaces Dev',
    googleSignInIosUrlScheme:
      'com.googleusercontent.apps.313729737871-eseii1s6at05c3ghugbaqbqiunjvqgpu',
    googleSignInIosClientId:
      '313729737871-eseii1s6at05c3ghugbaqbqiunjvqgpu.apps.googleusercontent.com',
    googleSignInWebClientId:
      '313729737871-2rmq2hms3c4r949c269fcb8dp199uht2.apps.googleusercontent.com',
    googleServicesRelDir: 'assets/configs/dev',
    usesCleartextTraffic: true,
    defaultPublicDeepLinkOrigin: 'https://spaces.xyne.juspay.net',
    defaultApiBaseUrl: 'https://app.spaces.xyne.juspay.net/api',
    androidReleaseStoreFile: '../../assets/secrets/xynespaces-release.keystore',
    androidReleaseKeyAlias: 'xynespacesrelease',
  },
  prod: {
    key: 'prod',
    androidApplicationId: 'net.juspay.xynespaces',
    iosBundleIdentifier: 'net.juspay.xynespaces',
    displayName: 'Xyne Spaces',
    googleSignInIosUrlScheme:
      'com.googleusercontent.apps.244924431232-gr3qaadt651729c1d2gg1n527j53ef8s',
    googleSignInIosClientId:
      '244924431232-gr3qaadt651729c1d2gg1n527j53ef8s.apps.googleusercontent.com',
    googleSignInWebClientId:
      '244924431232-5og3nosfdr8bl2huvrqg9hfrvveva9ea.apps.googleusercontent.com',
    googleServicesRelDir: 'assets/configs/prod',
    usesCleartextTraffic: false,
    defaultPublicDeepLinkOrigin: 'https://spaces.xyne.juspay.net',
    defaultApiBaseUrl: 'https://app.spaces.xyne.juspay.net/api',
    androidReleaseStoreFile: '../../assets/secrets/xynespaces-release.keystore',
    androidReleaseKeyAlias: 'xynespacesrelease',
  },
  sandbox: {
    key: 'sandbox',
    androidApplicationId: 'net.juspay.xynespaces',
    iosBundleIdentifier: 'net.juspay.xynespaces.sandbox',
    displayName: 'Xyne Spaces Sandbox',
    googleSignInIosUrlScheme:
      'com.googleusercontent.apps.244924431232-gr3qaadt651729c1d2gg1n527j53ef8s',
    googleSignInIosClientId:
      '244924431232-gr3qaadt651729c1d2gg1n527j53ef8s.apps.googleusercontent.com',
    googleSignInWebClientId:
      '244924431232-5og3nosfdr8bl2huvrqg9hfrvveva9ea.apps.googleusercontent.com',
    googleServicesRelDir: 'assets/configs/sandbox',
    usesCleartextTraffic: false,
    defaultPublicDeepLinkOrigin: 'https://spaces.xyne.juspay.net',
    defaultApiBaseUrl: 'https://app.spaces.xyne.juspay.net/api',
    androidReleaseStoreFile: '../../assets/secrets/xynespaces-release.keystore',
    androidReleaseKeyAlias: 'xynespacesrelease',
  },
  community: {
    key: 'community',
    androidApplicationId: 'net.juspay.xynespacescommunity',
    iosBundleIdentifier: 'net.juspay.xynespacescommunity',
    displayName: 'Xyne Spaces',
    googleSignInIosUrlScheme:
      'com.googleusercontent.apps.751927180866-gajl3rdjkd6llmce82kckqf2m1f1qinp',
    googleSignInIosClientId:
      '751927180866-gajl3rdjkd6llmce82kckqf2m1f1qinp.apps.googleusercontent.com',
    // Shared web client: the backend exchanges the app's serverAuthCode with this same ID.
    googleSignInWebClientId:
      '751927180866-ss9i1arhacif9gmh0kmclb89numegtbu.apps.googleusercontent.com',
    googleServicesRelDir: 'assets/configs/community',
    usesCleartextTraffic: false,
    defaultPublicDeepLinkOrigin: 'https://spaces.xyne.ai',
    defaultApiBaseUrl: 'https://spaces.xyne.ai/api',
    androidReleaseStoreFile: '../../assets/secrets/xyne-spaces-community.jks',
    androidReleaseKeyAlias: 'xyne-spaces-external',
    // Separate store listing, so it versions independently of the main app.
    // Bump iosBuildNumber on every TestFlight upload and androidVersionCode on every Play upload.
    version: '1.1.6',
    iosBuildNumber: '2',
    androidVersionCode: 7,
  },
};

/** @param {string | undefined} raw */
function resolveVariantKey(raw) {
  const k = (raw || 'prod').toLowerCase();
  if (k === 'dev' || k === 'prod' || k === 'sandbox' || k === 'community') return k;
  throw new Error(`Invalid APP_VARIANT "${raw}". Use dev | prod | sandbox | community.`);
}

/** Variant used during `expo prebuild` / config plugins (same as app.config.js). */
function getPrebuildVariant() {
  return getVariant(resolveVariantKey(process.env.APP_VARIANT));
}

/**
 * Base Android applicationId for defaultConfig (Expo prebuild).
 * Prod id must match non-dev flavors that don't override applicationId.
 */
function getDefaultAndroidApplicationId() {
  return VARIANTS.prod.androidApplicationId;
}

/**
 * Store builds (release signing, verified app links, runtime integrity checks).
 * @param {VariantKey} key
 */
function isProductionLikeVariant(key) {
  return key === 'prod' || key === 'community';
}

/**
 * @param {VariantKey} key
 */
function getVariant(key) {
  return VARIANTS[key];
}

function googleServicesJsonPath(variant) {
  return path.join(ROOT, variant.googleServicesRelDir, 'google-services.json');
}

function googleServicesPlistPath(variant) {
  return path.join(ROOT, variant.googleServicesRelDir, 'GoogleService-Info.plist');
}

/** @param {{ iosBundleIdentifier: string }} v */
function iosBroadcastExtensionBundleId(v) {
  return `${v.iosBundleIdentifier}.BroadcastExtension`;
}

/** @param {{ iosBundleIdentifier: string }} v */
function iosRecordingWidgetBundleId(v) {
  return `${v.iosBundleIdentifier}.RecordingWidget`;
}

/**
 * App Group for broadcast / screen share. Must exist in Apple Developer for this main bundle + extension.
 * @param {{ iosBundleIdentifier: string }} v
 */
function iosAppGroupIdentifier(v) {
  return `group.${v.iosBundleIdentifier}.share`;
}

/** BGTaskSchedulerPermittedIdentifiers entry. @param {{ iosBundleIdentifier: string }} v */
function iosAirborneOtaTaskIdentifier(v) {
  return `${v.iosBundleIdentifier}.airborne-ota`;
}

/**
 * APNs entitlement baked into ios/*.entitlements at prebuild time.
 * - `development` (default): sandbox APNs for Xcode Debug/Release installs on device.
 * - `production`: required for TestFlight / App Store — set LOTUS_APS_ENVIRONMENT=production before prebuild.
 * @returns {'development' | 'production'}
 */
function resolveIosApsEnvironment() {
  const raw = (process.env.LOTUS_APS_ENVIRONMENT || '').trim().toLowerCase();
  if (raw === 'production') {
    return 'production';
  }
  if (raw === 'development') {
    return 'development';
  }
  return 'development';
}

module.exports = {
  VARIANTS,
  resolveVariantKey,
  isProductionLikeVariant,
  getPrebuildVariant,
  getDefaultAndroidApplicationId,
  getVariant,
  googleServicesJsonPath,
  googleServicesPlistPath,
  iosBroadcastExtensionBundleId,
  iosRecordingWidgetBundleId,
  iosAppGroupIdentifier,
  iosAirborneOtaTaskIdentifier,
  resolveIosApsEnvironment,
};
