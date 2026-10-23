const { createRunOncePlugin, withMainApplication } = require('@expo/config-plugins');

const MARKER = '// Retain the Fabric tree during focus navigation (RN 0.86).';
const STARTUP_FIX = `
    ${MARKER}
    // loadReactNative installs RN's default provider. Replace it before creating
    // any React runtime, preserving the selected release level and all other flags.
    val startupFlags = when (DefaultNewArchitectureEntryPoint.releaseLevel) {
      ReleaseLevel.EXPERIMENTAL -> com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Experimental_Android()
      ReleaseLevel.CANARY -> com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Canary_Android()
      ReleaseLevel.STABLE -> com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsOverrides_RNOSS_Stable_Android()
    }
    val previouslyAccessedFlags = com.facebook.react.internal.featureflags.ReactNativeFeatureFlags.dangerouslyForceOverride(
      object : com.facebook.react.internal.featureflags.ReactNativeFeatureFlagsProvider by startupFlags {
        override fun fixFindShadowNodeByTagRaceCondition(): Boolean = true
      }
    )
    android.util.Log.d("FabricTreeLifetimeFix", "Startup flags accessed before override: $previouslyAccessedFlags")
`;

function patchMainApplication(contents) {
  if (contents.includes(MARKER)) return contents;
  const anchor = /\bloadReactNative\(this\)[ \t]*(?=\r?\n)/g;
  if ([...contents.matchAll(anchor)].length !== 1) {
    throw new Error('Fabric tree fix requires exactly one loadReactNative(this) startup call.');
  }
  return contents.replace(anchor, match => match + STARTUP_FIX.trimEnd());
}

function withReactNativeShadowTreeFixAndroid(config) {
  return withMainApplication(config, config => {
    if (config.modResults.language !== 'kt') {
      throw new Error('Fabric tree fix requires a Kotlin MainApplication.');
    }
    config.modResults.contents = patchMainApplication(config.modResults.contents);
    return config;
  });
}

module.exports = createRunOncePlugin(
  withReactNativeShadowTreeFixAndroid,
  'with-react-native-shadow-tree-fix-android',
  '1.0.0',
);
module.exports.patchMainApplication = patchMainApplication;
