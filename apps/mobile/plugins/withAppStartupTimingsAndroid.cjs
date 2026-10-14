const {
  createRunOncePlugin,
  withDangerousMod,
  withMainActivity,
  withMainApplication,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'with-app-startup-timings-android';
const PLUGIN_VERSION = '1.2.1';

function toPackagePath(androidPackage) {
  return androidPackage.split('.').join(path.sep);
}

function ensureDirectory(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function buildStartupTimesSource(androidPackage) {
  return `package ${androidPackage}

import android.content.Intent

object AppStartupTimes {
  @Volatile var appUptimeMs: Long? = null
  @Volatile var activityUptimeMs: Long? = null
  @Volatile var firstNativeFrameUptimeMs: Long? = null
  @Volatile var airborneInitStartUptimeMs: Long? = null
  @Volatile var airborneInitEndUptimeMs: Long? = null
  @Volatile var airborneStartAppUptimeMs: Long? = null
  @Volatile var isBackgrounded: Boolean = false
  @Volatile var launchCause: String = "direct"

  fun resolveLaunchCause(intent: Intent?): String {
    if (intent == null) return "direct"
    val action = intent.action
    if (action == Intent.ACTION_SEND || action == Intent.ACTION_SEND_MULTIPLE) {
      return "share"
    }
    val extras = intent.extras
    val callAction = extras?.getString("callAction")
    val callId = extras?.getString("callId")
    if (!callAction.isNullOrEmpty() || !callId.isNullOrEmpty()) {
      return "call"
    }
    // Notifee / FCM tray taps start MainActivity as MAIN/LAUNCHER with a
    // payload bundle. Launcher icon taps have extras == null.
    if (extras != null && !extras.isEmpty) {
      return "notification"
    }
    val data = intent.dataString
    if (!data.isNullOrEmpty()) {
      if (data.contains("share-target")) return "share"
      if (data.contains("/call/")) return "call"
      return "deeplink"
    }
    return "direct"
  }
}
`;
}

function buildStartupModuleSource(androidPackage) {
  return `package ${androidPackage}

import android.os.SystemClock
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeMap

class AppStartupModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = NAME

  @ReactMethod
  fun getLaunchTimes(promise: Promise) {
    val now = SystemClock.uptimeMillis()
    val map = WritableNativeMap()
    map.putString("platform", "android")
    AppStartupTimes.appUptimeMs?.let { map.putDouble("appUptimeMs", it.toDouble()) }
    AppStartupTimes.activityUptimeMs?.let { map.putDouble("activityUptimeMs", it.toDouble()) }
    AppStartupTimes.airborneInitStartUptimeMs?.let { map.putDouble("airborneInitStartUptimeMs", it.toDouble()) }
    AppStartupTimes.airborneInitEndUptimeMs?.let { map.putDouble("airborneInitEndUptimeMs", it.toDouble()) }
    AppStartupTimes.airborneStartAppUptimeMs?.let { map.putDouble("airborneStartAppUptimeMs", it.toDouble()) }
    AppStartupTimes.firstNativeFrameUptimeMs?.let { map.putDouble("firstNativeFrameUptimeMs", it.toDouble()) }
    map.putBoolean("isBackgrounded", AppStartupTimes.isBackgrounded)
    map.putString("launchCause", AppStartupTimes.launchCause)
    if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.N) {
      map.putDouble("processUptimeMs", android.os.Process.getStartUptimeMillis().toDouble())
    }
    map.putDouble("jsCallUptimeMs", now.toDouble())
    promise.resolve(map)
  }

  @ReactMethod
  fun nowUptimeMs(promise: Promise) {
    promise.resolve(SystemClock.uptimeMillis().toDouble())
  }

  companion object {
    const val NAME = "AppStartupModule"
  }
}
`;
}

function buildStartupPackageSource(androidPackage) {
  return `package ${androidPackage}

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

class AppStartupPackage : ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
    return listOf(AppStartupModule(reactContext))
  }

  override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<*, *>> {
    return emptyList()
  }
}
`;
}

function ensureImport(contents, importLine) {
  if (contents.includes(importLine)) return contents;
  const lines = contents.split('\n');
  const pkgIndex = lines.findIndex(l => l.startsWith('package '));
  const insertAt = pkgIndex >= 0 ? pkgIndex + 1 : 0;
  lines.splice(insertAt, 0, importLine, '');
  return lines.join('\n');
}

function withAppStartupModuleAndroid(config) {
  config = withDangerousMod(config, [
    'android',
    async config => {
      const { modRequest } = config;
      const projectRoot = modRequest.projectRoot;
      const androidPackage =
        config.android?.package || 'net.juspay.xynespaces';
      const packagePath = toPackagePath(androidPackage);
      const targetDir = path.join(
        projectRoot,
        'android',
        'app',
        'src',
        'main',
        'java',
        packagePath,
      );
      ensureDirectory(targetDir);

      fs.writeFileSync(path.join(targetDir, 'AppStartupTimes.kt'), buildStartupTimesSource(androidPackage));
      fs.writeFileSync(path.join(targetDir, 'AppStartupModule.kt'), buildStartupModuleSource(androidPackage));
      fs.writeFileSync(path.join(targetDir, 'AppStartupPackage.kt'), buildStartupPackageSource(androidPackage));

      return config;
    },
  ]);

  config = withMainApplication(config, config => {
    let src = config.modResults.contents;
    // Ensure SystemClock import
    src = ensureImport(src, 'import android.os.SystemClock');

    if (!src.includes('AppStartupTimes.appUptimeMs')) {
      const before = src;
      src = src.replace(
        /super\.onCreate\(\)\s*\n/,
        match => `${match}    AppStartupTimes.appUptimeMs = SystemClock.uptimeMillis()\n`,
      );
      if (src === before) {
        throw new Error('[with-app-startup-timings-android] Failed to inject appUptimeMs into MainApplication.onCreate');
      }
    }

    // Inject lifecycle callback for early background detection (before ReactContext init)
    src = ensureImport(src, 'import android.app.Activity');
    src = ensureImport(src, 'import android.app.Application');
    src = ensureImport(src, 'import android.os.Bundle');

    if (!src.includes('registerActivityLifecycleCallbacks')) {
      const lifecycleCallbackBlock = `    registerActivityLifecycleCallbacks(object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) {}
      override fun onActivityStarted(activity: Activity) {}
      override fun onActivityResumed(activity: Activity) {}
      override fun onActivityPaused(activity: Activity) {
        AppStartupTimes.isBackgrounded = true
      }
      override fun onActivityStopped(activity: Activity) {}
      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) {}
      override fun onActivityDestroyed(activity: Activity) {}
    })
`;
      if (src.includes('AppStartupTimes.appUptimeMs = SystemClock.uptimeMillis()')) {
        src = src.replace(
          /(AppStartupTimes\.appUptimeMs = SystemClock\.uptimeMillis\(\)\s*\n)/,
          match => `${match}${lifecycleCallbackBlock}`,
        );
      } else {
        src = src.replace(
          /(super\.onCreate\(\)\s*\n)/,
          match => `${match}    AppStartupTimes.appUptimeMs = SystemClock.uptimeMillis()\n${lifecycleCallbackBlock}`,
        );
      }
    }

    // Instrument Airborne init in the existing background thread
    if (src.includes('airborneManager.initialize(applicationContext, BuildConfig.VERSION_NAME)') &&
        !src.includes('AppStartupTimes.airborneInitStartUptimeMs')) {
      src = src.replace(
        'airborneManager.initialize(applicationContext, BuildConfig.VERSION_NAME)',
        [
          'AppStartupTimes.airborneInitStartUptimeMs = SystemClock.uptimeMillis()',
          'airborneManager.initialize(applicationContext, BuildConfig.VERSION_NAME)',
          'AppStartupTimes.airborneInitEndUptimeMs = SystemClock.uptimeMillis()',
        ].join('\n      '),
      );
    }

    if (!src.includes('add(AppStartupPackage())')) {
      src = src.replace(
        /PackageList\(this\)\.packages\.apply\s*\{\s*\n/,
        match => `${match}              add(AppStartupPackage())\n`,
      );
    }

    config.modResults.contents = src;
    return config;
  });

  config = withMainActivity(config, config => {
    let src = config.modResults.contents;
    src = ensureImport(src, 'import android.os.SystemClock');
    src = ensureImport(src, 'import android.view.Choreographer');

    if (!src.includes('AppStartupTimes.activityUptimeMs')) {
      const before = src;
      src = src.replace(
        /super\.onCreate\((?:null|savedInstanceState)\)\s*\n/,
        match => `    AppStartupTimes.activityUptimeMs = SystemClock.uptimeMillis()\n${match}`,
      );
      if (src === before) {
        throw new Error('[with-app-startup-timings-android] Failed to inject activityUptimeMs into MainActivity.onCreate');
      }
    }

    if (!src.includes('AppStartupTimes.launchCause')) {
      const before = src;
      src = src.replace(
        /AppStartupTimes\.activityUptimeMs = SystemClock\.uptimeMillis\(\)\s*\n/,
        match => `    AppStartupTimes.launchCause = AppStartupTimes.resolveLaunchCause(intent)\n${match}`,
      );
      if (src === before) {
        throw new Error('[with-app-startup-timings-android] Failed to inject launchCause into MainActivity.onCreate');
      }
    }

    if (!src.includes('AppStartupTimes.firstNativeFrameUptimeMs')) {
      const before = src;
      src = src.replace(
        /(super\.onCreate\((?:null|savedInstanceState)\)\s*\n)/,
        match => `${match}    Choreographer.getInstance().postFrameCallback(object : Choreographer.FrameCallback {\n      override fun doFrame(frameTimeNanos: Long) {\n        if (AppStartupTimes.firstNativeFrameUptimeMs == null) {\n          AppStartupTimes.firstNativeFrameUptimeMs = SystemClock.uptimeMillis()\n        }\n      }\n    })\n`,
      );
      if (src === before) {
        throw new Error('[with-app-startup-timings-android] Failed to inject firstNativeFrameUptimeMs into MainActivity.onCreate');
      }
    }

    config.modResults.contents = src;
    return config;
  });

  return config;
}

module.exports = createRunOncePlugin(withAppStartupModuleAndroid, PLUGIN_NAME, PLUGIN_VERSION);
