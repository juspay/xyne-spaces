import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const httpClientSource = readFileSync(
  resolve(process.cwd(), 'src/utils/mtlsHttpClient.ts'),
  'utf8',
);
const crashReporterSource = readFileSync(
  resolve(process.cwd(), 'src/utils/crashReporter.ts'),
  'utf8',
);
const nseSource = readFileSync(
  resolve(process.cwd(), 'plugins/notification-service/NotificationService.swift'),
  'utf8',
);
const firebaseConfig = JSON.parse(
  readFileSync(resolve(process.cwd(), 'firebase.json'), 'utf8'),
) as { 'react-native'?: Record<string, unknown> };
const androidCrashPluginSource = readFileSync(
  resolve(process.cwd(), 'plugins/with-lotus-crash-reporter-android/index.cjs'),
  'utf8',
);
const androidCrashStartupSource = readFileSync(
  resolve(process.cwd(), 'plugins/android-modules/crashreporter/CrashlyticsStartupPolicy.kt'),
  'utf8',
);
const androidAppConfigSource = readFileSync(
  resolve(process.cwd(), 'plugins/withAndroidAppConfig.cjs'),
  'utf8',
);
const deliverySource = readFileSync(
  resolve(process.cwd(), 'src/observability/logging/notification/notificationDelivery.ts'),
  'utf8',
);
const legacyLoggerSource = readFileSync(resolve(process.cwd(), 'src/utils/logger.ts'), 'utf8');
const activityMetricsSource = readFileSync(
  resolve(process.cwd(), 'src/services/metrics/activityMetrics.ts'),
  'utf8',
);
const screenMetricsSource = readFileSync(
  resolve(process.cwd(), 'src/services/metrics/screenMetrics.ts'),
  'utf8',
);
const redactorSource = readFileSync(
  resolve(process.cwd(), 'src/observability/logging/redactLogFields.ts'),
  'utf8',
);
const dashboardWebViewSource = readFileSync(
  resolve(process.cwd(), 'src/components/dashboard-webview/DashboardWebViewLayer.tsx'),
  'utf8',
);

describe('privacy metadata minimization', () => {
  it('does not send the user email on the native HTTP client', () => {
    assert.doesNotMatch(httpClientSource, /x-user-email/);
    assert.doesNotMatch(httpClientSource, /getEmailId\(\)/);
  });

  it('omits email from crash reports and Crashlytics attributes', () => {
    assert.match(crashReporterSource, /user_email: ''/);
    assert.doesNotMatch(crashReporterSource, /emailId:/);
    assert.doesNotMatch(crashReporterSource, /getEmailId\(\)/);
    assert.match(crashReporterSource, /setUserId\(sessionId\)/);
  });

  it('applies the remote logging opt-out to both crash transports', () => {
    assert.match(crashReporterSource, /LOGGER_CONFIG\.remoteLoggingEnabled/);
    assert.match(
      crashReporterSource,
      /setCrashlyticsCollectionEnabled\(this\.remoteLoggingEnabled\)/,
    );
    assert.match(crashReporterSource, /if \(!this\.remoteLoggingEnabled\) return;/);
  });

  it('keeps native Crashlytics opt-in until the build privacy gate runs', () => {
    assert.equal(firebaseConfig['react-native']?.['crashlytics_auto_collection_enabled'], false);
    assert.equal(firebaseConfig['react-native']?.['crashlytics_disable_auto_disabler'], undefined);
    assert.match(nseSource, /setCrashlyticsCollectionEnabled\(lotusRemoteLoggingEnabled\(\)\)/);
    assert.match(
      nseSource,
      /private func lotusEnsureFirebaseConfigured\(\) \{\s*guard lotusRemoteLoggingEnabled\(\) else/,
    );
    assert.match(nseSource, /if lotusRemoteLoggingEnabled\(\) \{/);
    assert.doesNotMatch(nseSource, /setCrashlyticsCollectionEnabled\(true\)/);
  });

  it('migrates Android collection overrides before Firebase providers start', () => {
    assert.match(androidCrashPluginSource, /override fun attachBaseContext/);
    assert.match(androidCrashPluginSource, /CrashlyticsStartupPolicy\.apply\(base\)/);
    assert.match(androidCrashStartupSource, /REMOTE_LOGGING_ENABLED/);
    assert.match(androidCrashStartupSource, /io\.invertase\.firebase/);
    assert.match(androidCrashStartupSource, /com\.google\.firebase\.crashlytics/);
    assert.match(androidCrashStartupSource, /crashlytics_auto_collection_enabled/);
    assert.match(androidCrashStartupSource, /firebase_crashlytics_collection_enabled/);
    assert.match(
      androidCrashStartupSource,
      /putBoolean\(RNFB_COLLECTION_KEY, BuildConfig\.REMOTE_LOGGING_ENABLED\)/,
    );
    assert.match(
      androidCrashStartupSource,
      /putBoolean\(FIREBASE_COLLECTION_KEY, BuildConfig\.REMOTE_LOGGING_ENABLED\)/,
    );
    assert.match(androidAppConfigSource, /REMOTE_LOGGING_ENABLED/);
  });

  it('whitelists notification identifiers instead of serializing full metadata', () => {
    assert.doesNotMatch(deliverySource, /metadata: readNotificationMetadata/);
    assert.match(deliverySource, /notificationId:/);
    assert.match(deliverySource, /notificationType:/);
    assert.match(deliverySource, /category:/);
    assert.doesNotMatch(nseSource, /metadataLogValue/);
    assert.doesNotMatch(nseSource, /received\["metadata"\]/);
    assert.doesNotMatch(nseSource, /metadataRaw=/);
    assert.match(nseSource, /received\["notificationId"\]/);
    assert.match(nseSource, /received\["notificationType"\]/);
    assert.match(nseSource, /received\["category"\]/);
  });

  it('limits email correlation to approved remote logs and keeps it out of metrics', () => {
    assert.match(
      legacyLoggerSource,
      /canIncludeEmailInRemoteLogs\(LOGGER_CONFIG\.eventsEndpoint, APP_VARIANT, __DEV__\)/,
    );
    assert.match(legacyLoggerSource, /email: this\.emailId/);
    assert.match(legacyLoggerSource, /this\.isAuthenticatedSession = true/);
    assert.match(legacyLoggerSource, /if \(!this\.isAuthenticatedSession\)/);
    assert.doesNotMatch(legacyLoggerSource, /if \(this\.emailId === null\)/);
    assert.doesNotMatch(activityMetricsSource, /emailId/);
    assert.doesNotMatch(screenMetricsSource, /emailId/);
    assert.match(redactorSource, /'email'/);
    assert.match(redactorSource, /'emailid'/);
  });

  it('does not expose the reusable session cookie through the WebView bridge', () => {
    assert.doesNotMatch(dashboardWebViewSource, /sessionId\?: string \| null/);
    assert.doesNotMatch(dashboardWebViewSource, /sessionId,/);
    assert.match(dashboardWebViewSource, /hasSessionCookie/);
    assert.match(dashboardWebViewSource, /areDashboardSessionCookiesSynchronized/);
    assert.match(dashboardWebViewSource, /CookieManager\.get\(\s*DASHBOARD_ORIGIN/);
    assert.doesNotMatch(dashboardWebViewSource, /ignore individual sync failures/);
  });
});
