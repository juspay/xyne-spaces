const { createRunOncePlugin, withAndroidManifest, withInfoPlist } = require('@expo/config-plugins');
const { getPrebuildVariant, isProductionLikeVariant } = require('../config/variants.cjs');
const { getConfiguredPublicDeepLinkOrigin } = require('../config/publicDeepLinkOrigin.cjs');

const PLUGIN_NAME = 'with-deep-links';
const PLUGIN_VERSION = '1.0.0';

const APP_SCHEME = 'xyne-spaces';
const LEGACY_APP_SCHEMES = ['lotus'];
const OWNED_APP_SCHEMES = [APP_SCHEME, ...LEGACY_APP_SCHEMES];
const ANDROID_MAIN_ACTIVITY = '.MainActivity';
const APP_LINK_HOST = new URL(getConfiguredPublicDeepLinkOrigin()).host;
const APP_PATH_PREFIXES = ['/call/', '/chat/dir/', '/recordings'];
const LEGACY_APP_LINK_HOSTS = [
  'localhost:5173',
  'spaces.xyne.juspay.net',
  'app.spaces.xyne.juspay.net',
  'app.spaces.sandbox.xyne.juspay.net',
  'xyne-spaces.web.app',
  'xyne-spaces.web',
  'spaces.sandbox.xyne.juspay.net',
  APP_LINK_HOST,
];

/**
 * android:pathPattern entries matching `pathPrefix` behind one or more leading
 * segments, so workspace/project-scoped links reach the app. pathPattern has no
 * "any char except /" construct — its `.*` spans `/` as well — so this single
 * pattern admits any leading-segment count. That is intentionally looser than
 * `CHAT_DIR_PATH` in `src/utils/messageDeepLinkCore.ts`, which caps the prefix at
 * two segments; a deeper path simply reaches the app and is then declined by the
 * parser rather than being routed to the browser.
 */
function leadingSegmentPathPatterns(pathPrefix) {
  return [`/.*${pathPrefix}.*`];
}

function withAndroidDeepLinks(config) {
  return withAndroidManifest(config, config => {
    const isProductionVariant = isProductionLikeVariant(getPrebuildVariant().key);
    const mainActivity = config.modResults.manifest.application?.[0]?.activity?.find(
      activity => activity.$?.['android:name'] === ANDROID_MAIN_ACTIVITY,
    );
    if (!mainActivity) return config;

    mainActivity['intent-filter'] ??= [];

    // Clean only filters previously owned by this plugin so incremental
    // prebuilds cannot retain the old scheme, hosts, HTTP, or broad paths.
    mainActivity['intent-filter'] = mainActivity['intent-filter'].filter(filter => {
      const hasOwnedScheme = filter.data?.some(data =>
        OWNED_APP_SCHEMES.includes(data.$?.['android:scheme']),
      );
      if (hasOwnedScheme) return false;

      const hasLegacyWebHost = filter.data?.some(data => {
        const scheme = data.$?.['android:scheme'];
        if (scheme !== 'http' && scheme !== 'https') return false;
        const host = data.$?.['android:host'];
        const port = data.$?.['android:port'];
        const hostWithPort = port ? `${host}:${port}` : host;
        return typeof hostWithPort === 'string' && LEGACY_APP_LINK_HOSTS.includes(hostWithPort);
      });
      return !hasLegacyWebHost;
    });

    mainActivity['intent-filter'].push({
      action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
      category: [
        { $: { 'android:name': 'android.intent.category.DEFAULT' } },
        { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
      ],
      data: [{ $: { 'android:scheme': APP_SCHEME } }],
    });

    if (isProductionVariant) {
      APP_PATH_PREFIXES.forEach(pathPrefix => {
        mainActivity['intent-filter'].push({
          $: { 'android:autoVerify': 'true' },
          action: [{ $: { 'android:name': 'android.intent.action.VIEW' } }],
          category: [
            { $: { 'android:name': 'android.intent.category.DEFAULT' } },
            { $: { 'android:name': 'android.intent.category.BROWSABLE' } },
          ],
          data: [
            {
              $: {
                'android:scheme': 'https',
                'android:host': APP_LINK_HOST,
                'android:pathPrefix': pathPrefix,
              },
            },
            // The web app emits workspace- and project-scoped links
            // (`/<workspaceId>[/<projectId>]/chat/dir/<channelId>`). android:pathPrefix
            // anchors at the path root, so those never match it and the OS would hand
            // the link to the browser instead of the app. android:pathPattern's `.*`
            // matches `/` too, so a single leading `/.*` already covers any number of
            // leading segments; the runtime parser is what enforces the two-segment
            // limit, and over-matching here only costs an in-app no-op.
            ...leadingSegmentPathPatterns(pathPrefix).map(pathPattern => ({
              $: {
                'android:scheme': 'https',
                'android:host': APP_LINK_HOST,
                'android:pathPattern': pathPattern,
              },
            })),
          ],
        });
      });
    }

    return config;
  });
}

function withIOSDeepLinks(config) {
  return withInfoPlist(config, config => {
    const v = getPrebuildVariant();
    const infoPlist = config.modResults;
    infoPlist.CFBundleURLTypes ??= [];

    infoPlist.CFBundleURLTypes = infoPlist.CFBundleURLTypes.map(type => {
      const schemes = type.CFBundleURLSchemes;
      if (!Array.isArray(schemes)) return type;
      const remainingSchemes = schemes.filter(scheme => !LEGACY_APP_SCHEMES.includes(scheme));
      return remainingSchemes.length === schemes.length
        ? type
        : { ...type, CFBundleURLSchemes: remainingSchemes };
    }).filter(
      type => !Array.isArray(type.CFBundleURLSchemes) || type.CFBundleURLSchemes.length > 0,
    );

    const hasAppScheme = infoPlist.CFBundleURLTypes.some(type =>
      type.CFBundleURLSchemes?.includes(APP_SCHEME),
    );
    if (!hasAppScheme) {
      infoPlist.CFBundleURLTypes.push({
        CFBundleURLName: `${v.iosBundleIdentifier}.deep_link`,
        CFBundleURLSchemes: [APP_SCHEME],
      });
    }

    return config;
  });
}

function withDeepLinks(config) {
  return withIOSDeepLinks(withAndroidDeepLinks(config));
}

module.exports = createRunOncePlugin(withDeepLinks, PLUGIN_NAME, PLUGIN_VERSION);
