import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const DEVICE_REGISTRY_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/notifications/backend/deviceRegistry.ts'),
  'utf8',
);
const CALL_SETUP_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/notifications/calls/callSetup.ts'),
  'utf8',
);
const NOTIFICATION_SERVICES_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/services/NotificationServices.ts'),
  'utf8',
);
const NATIVE_CALL_PLUGIN_SOURCE = readFileSync(
  resolve(process.cwd(), 'plugins/withNativeIncomingCallAndroid.cjs'),
  'utf8',
);
// eslint-disable-next-line @typescript-eslint/no-require-imports
const nativeCallPlugin = require(
  resolve(process.cwd(), 'plugins/withNativeIncomingCallAndroid.cjs'),
) as {
  sanitizeLegacyLaunchIntentLogs: (contents: string) => string;
};

describe('notification registration lifecycle guards', () => {
  it('does not commit a late registration after logout, but allows the next session', () => {
    assert.match(DEVICE_REGISTRY_SOURCE, /getAuthSessionGeneration\(\)/);
    assert.match(DEVICE_REGISTRY_SOURCE, /getAuthOperation\(\)/);
    assert.match(
      DEVICE_REGISTRY_SOURCE,
      /await registerMobilePushToken\(authToken,[\s\S]*?if \(!canCommitDeviceRegistration\(/,
    );
    assert.match(DEVICE_REGISTRY_SOURCE, /lastRegisteredToken = fcmToken/);
  });

  it('rejects a VoIP completion when logout or a newer token supersedes it', () => {
    assert.match(CALL_SETUP_SOURCE, /const authGeneration = getAuthSessionGeneration\(\)/);
    assert.match(CALL_SETUP_SOURCE, /const authOperation = getAuthOperation\(\)/);
    assert.match(
      CALL_SETUP_SOURCE,
      /import \{[\s\S]*canCommitVoipRegistration[\s\S]*\} from '\.\.\/registrationLifecyclePolicy'/,
    );
    assert.match(
      CALL_SETUP_SOURCE,
      /await registerMobilePushToken\(authToken,[\s\S]*?if \(!canCommitVoipRegistration\(/,
    );
    assert.doesNotMatch(CALL_SETUP_SOURCE, /return pendingToken === voipToken/);
    assert.match(CALL_SETUP_SOURCE, /setString\(IOS_VOIP_TOKEN_KEY, voipToken\)/);
  });

  it('does not write push-token fragments to logs', () => {
    assert.doesNotMatch(CALL_SETUP_SOURCE, /voipToken\.slice\(/);
    assert.doesNotMatch(CALL_SETUP_SOURCE, /fcmToken\.slice\(/);
    assert.match(CALL_SETUP_SOURCE, /hasVoipToken: true/);
    assert.match(CALL_SETUP_SOURCE, /hasFcmToken: true/);
  });

  it('does not dump native call intents or payload identifiers to logs', () => {
    const legacyMainActivity = [
      'android.util.Log.d("LaunchIntent", "onCreate called, intent=" + intent + ", extras=" + intent?.extras)',
      'android.util.Log.d("LaunchIntent", "Captured launch intent extras: callId=" + extras.getString("callId") + ", callAction=" + extras.getString("callAction"))',
      'android.util.Log.d("LaunchIntent", "onNewIntent called, extras=" + intent.extras)',
      'android.util.Log.d("LaunchIntent", "onNewIntent captured extras: callId=" + extras.getString("callId") + ", callAction=" + extras.getString("callAction"))',
    ].join('\n');
    const sanitized = nativeCallPlugin.sanitizeLegacyLaunchIntentLogs(legacyMainActivity);

    assert.doesNotMatch(sanitized, /Log\.d\("LaunchIntent", "[^\n]*intent=/);
    assert.doesNotMatch(sanitized, /Log\.d\("LaunchIntent", "[^\n]*callId=/);
    assert.match(sanitized, /hasIntent=/);
    assert.match(sanitized, /hasExtras=/);
    assert.match(NATIVE_CALL_PLUGIN_SOURCE, /hasCallId=/);
    assert.doesNotMatch(
      NATIVE_CALL_PLUGIN_SOURCE,
      /\bLog\.[devwi]\([^\n]*(?:callId=\$callId|callId=" \+ callId|caller=\$callerName|callerName)/,
    );
    assert.doesNotMatch(NATIVE_CALL_PLUGIN_SOURCE, /safeRecordException\([^\n]*callId/);
    assert.match(
      NATIVE_CALL_PLUGIN_SOURCE,
      /contents = sanitizeLegacyLaunchIntentLogs\(contents\)/,
    );
    assert.equal(nativeCallPlugin.sanitizeLegacyLaunchIntentLogs(sanitized), sanitized);
  });

  it('uses the registration call bearer instead of resolving a newer global token', () => {
    assert.match(
      NOTIFICATION_SERVICES_SOURCE,
      /const headers = \{ Authorization: `Bearer \$\{trimmedAuthToken\}` \};/,
    );
    assert.doesNotMatch(
      NOTIFICATION_SERVICES_SOURCE,
      /const headers = await buildAuthenticatedHeaders\(\)/,
    );
  });

  it('sends device and workspace scope when unregistering a push binding', () => {
    assert.match(
      NOTIFICATION_SERVICES_SOURCE,
      /unregisterMobilePushToken\([\s\S]*?request: UnregisterMobilePushTokenRequest,/,
    );
    assert.match(NOTIFICATION_SERVICES_SOURCE, /const deviceId = request\.deviceId\?\.trim\(\)/);
    assert.match(NOTIFICATION_SERVICES_SOURCE, /deviceId,\n\s*\.\.\.\(request\.workspaceId/);
    assert.match(NOTIFICATION_SERVICES_SOURCE, /workspaceId: request\.workspaceId\.trim\(\)/);
    assert.match(DEVICE_REGISTRY_SOURCE, /unregisterMobilePushToken\(authToken,/);
    assert.match(DEVICE_REGISTRY_SOURCE, /if \(!deviceId\)[\s\S]*?without a device binding/);
    assert.match(
      DEVICE_REGISTRY_SOURCE,
      /deviceId,\n\s*\.\.\.\(workspaceId \? \{ workspaceId \} : \{\}\)/,
    );
    assert.match(DEVICE_REGISTRY_SOURCE, /DEVICE_UNREGISTER_MAX_ATTEMPTS = 2/);
    assert.match(
      DEVICE_REGISTRY_SOURCE,
      /for \(let attempt = 0; attempt < DEVICE_UNREGISTER_MAX_ATTEMPTS; attempt \+= 1\)/,
    );
    assert.match(DEVICE_REGISTRY_SOURCE, /waitForDeviceUnregisterRetry\(/);
    assert.match(
      DEVICE_REGISTRY_SOURCE,
      /const deadline = Date\.now\(\) \+ DEVICE_UNREGISTER_TIMEOUT_MS/,
    );
    assert.match(DEVICE_REGISTRY_SOURCE, /if \(!isCurrent\(\)\) return/);
    assert.match(DEVICE_REGISTRY_SOURCE, /shouldRetryDeviceUnregister\(error\)/);
    assert.match(
      DEVICE_REGISTRY_SOURCE,
      /if \(!shouldRetryDeviceUnregister\(error\)\) throw error/,
    );
  });
});
