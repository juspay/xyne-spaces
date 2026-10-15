const { createRunOncePlugin, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

const PLUGIN_NAME = 'with-livekit-android-setup';
const PLUGIN_VERSION = '1.0.0';
const LIVEKIT_IMPORT = 'import com.livekit.reactnative.LiveKitReactNative';
const LIVEKIT_SETUP_CALL = 'LiveKitReactNative.setup(this)';

function withLiveKitAndroidSetup(config) {
  return withDangerousMod(config, [
    'android',
    config => {
      const mainApplicationPath = path.join(
        config.modRequest.platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        'net',
        'juspay',
        'xynespaces',
        'MainApplication.kt',
      );

      let contents = readFileIfExists(mainApplicationPath);
      if (contents === null) {
        return config;
      }

      if (!contents.includes(LIVEKIT_IMPORT)) {
        contents = contents.replace(/^(package [^\n]+\n)/m, `$1\n${LIVEKIT_IMPORT}\n`);
      }

      if (!contents.includes(LIVEKIT_SETUP_CALL)) {
        contents = contents.replace(
          /override fun onCreate\(\) \{\s*super\.onCreate\(\)/,
          match => `${match}\n    ${LIVEKIT_SETUP_CALL}`,
        );
      }

      fs.writeFileSync(mainApplicationPath, contents);
      return config;
    },
  ]);
}

module.exports = createRunOncePlugin(withLiveKitAndroidSetup, PLUGIN_NAME, PLUGIN_VERSION);
