const { AndroidConfig, createRunOncePlugin, withAndroidManifest } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-notifee-receiver-hardening-android';
const PLUGIN_VERSION = '1.0.0';

// react-native-notify-kit (Notifee fork) declares this trampoline activity with
// android:exported="true". It hands any incoming Intent to NotificationReceiverHandler,
// so another installed app could forge an ACTION_PRESS + RemoteInput "Reply" and make
// us post a chat message as the signed-in user (bug bounty #43).
//
// The only legitimate caller is our own notification PendingIntent, and a PendingIntent
// created by this app can always start our non-exported components, so we force
// exported="false" through the manifest merger.
const NOTIFEE_RECEIVER_ACTIVITY = 'app.notifee.core.NotificationReceiverActivity';

function withNotifeeReceiverHardeningAndroid(config) {
  return withAndroidManifest(config, modConfig => {
    const manifest = modConfig.modResults;
    AndroidConfig.Manifest.ensureToolsAvailable(manifest);

    const application = AndroidConfig.Manifest.getMainApplicationOrThrow(manifest);
    application.activity = application.activity || [];

    let entry = application.activity.find(
      activity => activity.$?.['android:name'] === NOTIFEE_RECEIVER_ACTIVITY,
    );
    if (!entry) {
      entry = { $: { 'android:name': NOTIFEE_RECEIVER_ACTIVITY } };
      application.activity.push(entry);
    }

    entry.$['android:exported'] = 'false';
    const replaced = new Set(
      (entry.$['tools:replace'] || '')
        .split(',')
        .map(attr => attr.trim())
        .filter(Boolean),
    );
    replaced.add('android:exported');
    entry.$['tools:replace'] = [...replaced].join(',');

    return modConfig;
  });
}

module.exports = createRunOncePlugin(
  withNotifeeReceiverHardeningAndroid,
  PLUGIN_NAME,
  PLUGIN_VERSION,
);
