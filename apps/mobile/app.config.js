require('./config/loadLotusEnv.cjs').loadLotusEnv();
const { getConfiguredPublicDeepLinkOrigin } = require('./config/publicDeepLinkOrigin.cjs');

const {
  resolveVariantKey,
  isProductionLikeVariant,
  getVariant,
  getDefaultAndroidApplicationId,
  googleServicesJsonPath,
  googleServicesPlistPath,
  iosAppGroupIdentifier,
} = require('./config/variants.cjs');

/**
 * Expo evaluates this file with Sucrase + requireFromString (CommonJS).
 * With package.json "type": "module", shared helpers must live in .cjs files.
 */
module.exports = ({ config }) => {
  const variantKey = resolveVariantKey(process.env.APP_VARIANT);
  const v = getVariant(variantKey);
  const publicDeepLinkOrigin = getConfiguredPublicDeepLinkOrigin();
  const publicDeepLinkDomain = `applinks:${new URL(publicDeepLinkOrigin).host}`;
  const isProductionVariant = isProductionLikeVariant(variantKey);
  const isCommunityVariant = variantKey === 'community';

  const defaultAndroidApplicationId = getDefaultAndroidApplicationId();

  return {
    ...config,
    name: v.displayName,
    slug: 'lotus',
    version: v.version ?? '1.0.0',
    orientation: 'portrait',
    icon: './assets/images/Xyne_Spaces-Default-1024x1024.png',
    scheme: 'xyne-spaces',
    userInterfaceStyle: 'automatic',
    ios: {
      deploymentTarget: '16.4',
      supportsTablet: true,
      ...(v.iosBuildNumber ? { buildNumber: v.iosBuildNumber } : {}),
      bundleIdentifier: v.iosBundleIdentifier,
      googleServicesFile: googleServicesPlistPath(v),
      appleTeamId: 'YM9U73Z2JM',
      entitlements: { 'aps-environment': 'development' },
      infoPlist: {
        CFBundleURLTypes: [
          { CFBundleURLSchemes: ['xyne-spaces'] },
          { CFBundleURLSchemes: [v.googleSignInIosUrlScheme] },
        ],
        // Required for Linking.canOpenURL('itms-beta://') — detect TestFlight install
        LSApplicationQueriesSchemes: ['itms-beta'],
        NSCameraUsageDescription:
          'Allow Xyne Spaces to use your camera for calls, attachments, and device enrollment.',
        NSMicrophoneUsageDescription:
          'Allow Xyne Spaces to use your microphone for calls and voice features.',
        NSLocationWhenInUseUsageDescription: 'Allow Xyne Spaces to access your location.',
        UIBackgroundModes: ['voip', 'remote-notification', 'fetch', 'audio'],
        AppGroupIdentifier: iosAppGroupIdentifier(v),
      },
      // Only the production binary owns the public App/Universal Link domain. Development
      // and sandbox builds keep the custom scheme but must not claim production HTTPS links.
      associatedDomains: isProductionVariant ? [publicDeepLinkDomain] : [],
    },
    android: {
      // Kotlin namespace; the shipped applicationId per flavor is set in withAndroidProductFlavors.
      package: defaultAndroidApplicationId,
      ...(v.androidVersionCode ? { versionCode: v.androidVersionCode } : {}),
      googleServicesFile: googleServicesJsonPath(v),
      predictiveBackGestureEnabled: false,
      notification: {
        icon: './assets/images/notification.png',
        color: '#ffffff',
      },
      permissions: [
        'android.permission.RECORD_AUDIO',
        'android.permission.CAMERA',
        'android.permission.FOREGROUND_SERVICE',
        'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
        'android.permission.FOREGROUND_SERVICE_DATA_SYNC',
        'android.permission.POST_NOTIFICATIONS',
        'android.permission.READ_MEDIA_IMAGES',
        'android.permission.WRITE_EXTERNAL_STORAGE',
        // Haptic feedback. Reaches the merged manifest via autolinked libraries
        // anyway, but those are incidental — declare it so the app owns it.
        'android.permission.VIBRATE',
      ],
      // Community invite links. `autoVerify` additionally requires /.well-known/assetlinks.json
      // to be served by the public deep-link host.
      ...(isCommunityVariant
        ? {
            intentFilters: [
              {
                action: 'VIEW',
                autoVerify: true,
                data: [
                  {
                    scheme: 'https',
                    host: new URL(publicDeepLinkOrigin).host,
                    pathPrefix: '/community/join',
                  },
                ],
                category: ['BROWSABLE', 'DEFAULT'],
              },
            ],
          }
        : {}),
    },
    web: config?.web ?? {
      output: 'static',
      favicon: './assets/images/Xyne_Spaces-Default-1024x1024.png',
    },
    plugins: [
      'expo-asset',
      '@react-native-community/datetimepicker',
      './plugins/withAppStartupTimingsIOS.cjs',
      './plugins/withFirebaseModularHeaders.cjs',
      './plugins/withEnrichedMarkdownNoMath.cjs',
      './plugins/withAndroidAppConfig.cjs',
      './plugins/withAndroidBackupProtection.cjs',
      './plugins/withAndroidReleaseSigning.cjs',
      './plugins/withAndroidProductFlavors.cjs',
      './plugins/withAsyncStorageLocalRepo.cjs',
      './plugins/withLiveKitAndroidSetup.cjs',
      './plugins/withCallKeepAndroidManifest.cjs',
      './plugins/withCallKeepAndroidCompat.cjs',
      './plugins/withNativeIncomingCallAndroid.cjs',
      './plugins/withRecordingWidgetAndroid.cjs',
      './plugins/withVoipPushIOS.cjs',
      './plugins/withBroadcastExtensionIOS.cjs',
      './plugins/withRecordingWidgetIOS.cjs',
      './plugins/withIosGoogleServiceCopy.cjs',
      './plugins/withSharedAuthTokenIOS.cjs',
      './plugins/withNotificationServiceIOS.cjs',
      './plugins/withScreenShareAndroid.cjs',
      './plugins/withDeepLinks.cjs',
      './plugins/withAppStartupTimingsAndroid.cjs',
      './plugins/withReactNativeShadowTreeFixAndroid.cjs',
      ['@react-native-google-signin/google-signin', { iosUrlScheme: v.googleSignInIosUrlScheme }],
      './plugins/withShareTargetAndroid.cjs',
      './plugins/withShareTargetIOS.cjs',
      'expo-router',
      // Morning Brief title face (matches the dashboard's font-serif). Family
      // name resolves as the file's PostScript name: LibreBaskerville-Italic.
      ['expo-font', { fonts: ['./assets/fonts/LibreBaskerville-Italic.ttf'] }],
      './plugins/withNotificationIconManifestFix.cjs',
      './plugins/withNotifeeReceiverHardeningAndroid.cjs',
      [
        'expo-notifications',
        {
          icon: './assets/images/notification.png',
          color: '#ffffff',
        },
      ],
      '@react-native-firebase/crashlytics',
      [
        'expo-splash-screen',
        {
          image: './assets/images/Xyne_Spaces-Default-1024x1024.png',
          imageWidth: 190,
          resizeMode: 'native',
          backgroundColor: '#ffffff',
          dark: { backgroundColor: '#000000' },
        },
      ],
      [
        'expo-image-picker',
        {
          photosPermission: 'Allow Xyne Spaces to access photos for attachments.',
          cameraPermission:
            'Allow Xyne Spaces to use your camera for calls, attachments, and device enrollment.',
        },
      ],
      [
        'expo-media-library',
        {
          photosPermission: 'Allow Xyne Spaces to save images to your photo library.',
          savePhotosPermission: 'Allow Xyne Spaces to save images to your photo library.',
          isAccessMediaLocationEnabled: true,
        },
      ],
      'expo-document-picker',
      './plugins/with-certificate-module-ios/index.cjs',
      './plugins/with-certificate-module-android/index.cjs',
      './plugins/with-integrity-module-android/index.cjs',
      './plugins/with-lotus-crash-reporter-ios/index.cjs',
      './plugins/with-lotus-crash-reporter-android/index.cjs',
      './plugins/with-downloads-module-android/index.cjs',
      [
        'react-native-vision-camera',
        {
          cameraPermissionText:
            'Allow Xyne Spaces to use your camera for calls, attachments, and device enrollment.',
          enableMicrophonePermission: true,
          microphonePermissionText:
            'Allow Xyne Spaces to use your microphone for calls and voice features.',
        },
      ],
      './plugins/withNotificationSounds.cjs',
    ],
    experiments: { typedRoutes: true, reactCompiler: true },
    extra: {
      ...config?.extra,
      appVariant: variantKey,
      googleSignInIosClientId: v.googleSignInIosClientId,
      googleSignInWebClientId: v.googleSignInWebClientId,
      /**
       * Baked at config-eval time (after loadLotusEnv). Do not read `process.env.EXPO_PUBLIC_*` in app code:
       * Metro/Babel workers can have a different `process.env` than the parent, so Expo's env inlining
       * may bake wrong URLs (e.g. localhost) into OTA bundles. `expo-constants` extra is stable.
       */
      lotusApiBaseUrl: (
        process.env.EXPO_PUBLIC_API_BASE_URL ||
        process.env.API_BASE_URL ||
        ''
      ).trim(),
      lotusDashboardOrigin: (process.env.EXPO_PUBLIC_DASHBOARD_ORIGIN || '').trim(),
      lotusPublicDeepLinkOrigin: publicDeepLinkOrigin,
      lotusAppEnv: (process.env.EXPO_PUBLIC_APP_ENV || process.env.APP_ENV || '').trim(),
      lotusMtlsEnabled: (
        process.env.EXPO_PUBLIC_MTLS_ENABLED ||
        process.env.MTLS_ENABLED ||
        'true'
      ).trim(),
      /**
       * PY-JP-013 runtime code-integrity checks. Active only for the `prod` variant AND only in
       * release builds — the plugin writes INTEGRITY_ENFORCED=false into defaultConfig and true
       * into buildTypes.release. Two reasons: dev/sandbox are signed with the committed debug
       * keystore (the signature pin would correctly reject them), and any debug build is always
       * FLAG_DEBUGGABLE, so enforcing there could only ever block `pnpm run android:prod:debug`.
       * Set LOTUS_INTEGRITY_ENFORCED=false to disable everywhere if a bad pin ever ships.
       */
      lotusIntegrityEnforced:
        isProductionVariant &&
        (process.env.LOTUS_INTEGRITY_ENFORCED || 'true').trim().toLowerCase() !== 'false',
      lotusIntegritySigningSha256: (process.env.LOTUS_INTEGRITY_SIGNING_SHA256 || '').trim(),
      /**
       * Trusted install sources. Set the variable to an empty value to disable *only* the
       * install-origin check while keeping the signature and anti-debug checks active — needed
       * to run a real release build locally, since `adb install` records no installing package:
       *   LOTUS_INTEGRITY_ALLOWED_INSTALLERS= pnpm run prebuild:prod
       * An unset variable keeps the production default.
       */
      lotusIntegrityAllowedInstallers:
        process.env.LOTUS_INTEGRITY_ALLOWED_INSTALLERS !== undefined
          ? process.env.LOTUS_INTEGRITY_ALLOWED_INSTALLERS.trim()
          : 'com.android.vending',
      lotusMicrosoftClientId: (
        process.env.EXPO_PUBLIC_MICROSOFT_CLIENT_ID ||
        process.env.MICROSOFT_CLIENT_ID ||
        ''
      ).trim(),
      lotusMicrosoftTenantId: (
        process.env.EXPO_PUBLIC_MICROSOFT_TENANT_ID ||
        process.env.MICROSOFT_TENANT_ID ||
        ''
      ).trim(),
      lotusZeroServerUrl: (process.env.EXPO_PUBLIC_ZERO_SERVER_URL || '').trim(),
      // Metrics configuration. The endpoint is a base URL; app code appends /godel/v1/metrics.
      lotusTelemetryMode: (process.env.LOTUS_TELEMETRY_MODE || '').trim(),
      lotusTelemetryEndpoint: (process.env.LOTUS_TELEMETRY_ENDPOINT || '').trim(),
      // Empty string keeps the default: release builds on, debug builds off.
      lotusMetricsEnabled: (process.env.LOTUS_METRICS_ENABLED || '').trim(),
      // Separate Grafana logs bridge endpoint (e.g. http://localhost:4001)
      // Overrides eventsEndpoint only; metricsEndpoint continues to use lotusTelemetryEndpoint
      lotusGrafanaLogsEndpoint: (process.env.LOTUS_GRAFANA_LOGS_ENDPOINT || '').trim(),
      // Empty string keeps the default: prod release on, prod debug / dev / sandbox off.
      lotusRemoteLoggingEnabled: (process.env.LOTUS_REMOTE_LOGGING_ENABLED || '').trim(),
    },
  };
};
