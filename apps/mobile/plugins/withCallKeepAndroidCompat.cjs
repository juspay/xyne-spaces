const { createRunOncePlugin, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

const PLUGIN_NAME = 'with-callkeep-android-compat';
const PLUGIN_VERSION = '1.0.0';

function withCallKeepAndroidCompat(config) {
  return withDangerousMod(config, [
    'android',
    (config) => {
      const modulePath = path.join(
        config.modRequest.projectRoot,
        'node_modules',
        'react-native-callkeep',
        'android',
        'src',
        'main',
        'java',
        'io',
        'wazo',
        'callkeep',
        'RNCallKeepModule.java',
      );

      let contents = readFileIfExists(modulePath);
      if (contents === null) {
        return config;
      }
      const replacements = [
        {
          target: `@ReactMethod
    public void displayIncomingCall(String uuid, String number, String callerName) {
        this.displayIncomingCall(uuid, number, callerName, false, null);
    }`,
          replacement: `//     @ReactMethod
//     public void displayIncomingCall(String uuid, String number, String callerName) {
//         this.displayIncomingCall(uuid, number, callerName, false, null);
//     }`,
        },
        {
          target: `@ReactMethod
    public void startCall(String uuid, String number, String callerName) {
        this.startCall(uuid, number, callerName, false, null);
    }`,
          replacement: `//     @ReactMethod
//     public void startCall(String uuid, String number, String callerName) {
//         this.startCall(uuid, number, callerName, false, null);
//     }`,
        },
        {
          target: `        PhoneAccount.Builder builder = new PhoneAccount.Builder(handle, appName);
        if (isSelfManaged()) {
            builder.setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED);
        }
        else {
            builder.setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER);
        }`,
          replacement: `        try {
            PhoneAccount existing = telecomManager.getPhoneAccount(handle);
            if (existing != null) {
                telecomManager.unregisterPhoneAccount(handle);
            }
        } catch (Exception e) {
            Log.w(TAG, "[RNCallKeepModule] Failed to unregister stale phone account", e);
        }

        PhoneAccount.Builder builder = new PhoneAccount.Builder(handle, appName);
        if (isSelfManaged()) {
            builder.setCapabilities(PhoneAccount.CAPABILITY_SELF_MANAGED);
        } else {
            builder.setCapabilities(PhoneAccount.CAPABILITY_CALL_PROVIDER);
        }`,
        },
        // PATCH: Prevent setup() from automatically registering phone account
        // This stops the system Phone Account dialog from appearing every time the app opens
        // We handle phone account registration manually in CallKitService instead
        {
          target: `        if (isConnectionServiceAvailable()) {
            this.registerPhoneAccount(options);
            this.registerEvents();
            this.startObserving();
            VoiceConnectionService.setAvailable(true);
        }`,
          replacement: `        if (isConnectionServiceAvailable()) {
            // PATCH: Skip automatic phone account registration to prevent popup on every app open
            // this.registerPhoneAccount(options);
            this.registerEvents();
            this.startObserving();
            VoiceConnectionService.setAvailable(true);
        }`,
        },
      ];

      let updated = false;
      for (const { target, replacement } of replacements) {
        if (contents.includes(target)) {
          contents = contents.replace(target, replacement);
          updated = true;
        }
      }

      if (updated) {
        fs.writeFileSync(modulePath, contents);
      }

      return config;
    },
  ]);
}

module.exports = createRunOncePlugin(withCallKeepAndroidCompat, PLUGIN_NAME, PLUGIN_VERSION);