const { createRunOncePlugin, withAndroidManifest } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-notification-icon-manifest-fix';
const PLUGIN_VERSION = '1.0.0';

const CONFLICTING_META_DATA = [
  'com.google.firebase.messaging.default_notification_color',
  'com.google.firebase.messaging.default_notification_icon',
];

function withNotificationIconManifestFix(config) {
  return withAndroidManifest(config, modConfig => {
    const application = modConfig.modResults.manifest.application;
    if (!Array.isArray(application)) return modConfig;

    for (const app of application) {
      const metaDataItems = app['meta-data'];
      if (!Array.isArray(metaDataItems)) continue;

      for (const item of metaDataItems) {
        const name = item.$?.['android:name'];
        if (CONFLICTING_META_DATA.includes(name)) {
          item.$ = item.$ || {};
          item.$['tools:replace'] = 'android:resource';
        }
      }
    }

    return modConfig;
  });
}

module.exports = createRunOncePlugin(
  withNotificationIconManifestFix,
  PLUGIN_NAME,
  PLUGIN_VERSION,
);
