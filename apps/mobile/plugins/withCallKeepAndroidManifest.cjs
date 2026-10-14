const { createRunOncePlugin, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

const PLUGIN_NAME = 'with-callkeep-android-manifest';
const PLUGIN_VERSION = '1.0.0';

function withCallKeepAndroidManifest(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const manifestPath = path.join(
        config.modRequest.projectRoot,
        'android',
        'app',
        'src',
        'main',
        'AndroidManifest.xml',
      );

      let contents = readFileIfExists(manifestPath);
      if (contents === null) {
        return config;
      }
      const permissions = [
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE"/>',
        '<uses-permission android:name="android.permission.FOREGROUND_SERVICE_PHONE_CALL"/>',
        '<uses-permission android:name="android.permission.MANAGE_OWN_CALLS"/>',
      ];

      for (const permission of permissions) {
        if (!contents.includes(permission)) {
          contents = contents.replace(
            '<uses-permission android:name="android.permission.INTERNET"/>',
            `<uses-permission android:name="android.permission.INTERNET"/>\n  ${permission}`,
          );
        }
      }

      const voiceConnectionService = `    <service
      android:name="io.wazo.callkeep.VoiceConnectionService"
      android:permission="android.permission.BIND_TELECOM_CONNECTION_SERVICE"
      android:foregroundServiceType="phoneCall|microphone"
      android:exported="true">
      <intent-filter>
        <action android:name="android.telecom.ConnectionService"/>
      </intent-filter>
    </service>`;
      const backgroundService = `    <service
      android:name="io.wazo.callkeep.RNCallKeepBackgroundMessagingService"
      android:exported="false"/>`;

      if (!contents.includes('io.wazo.callkeep.VoiceConnectionService')) {
        contents = contents.replace('</application>', `${voiceConnectionService}\n${backgroundService}\n  </application>`);
      }

      fs.writeFileSync(manifestPath, contents);
      return config;
    },
  ]);
}

module.exports = createRunOncePlugin(withCallKeepAndroidManifest, PLUGIN_NAME, PLUGIN_VERSION);