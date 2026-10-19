const {
  withPlugins,
  withDangerousMod,
  withMainApplication,
  withAppBuildGradle,
} = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

/**
 * Copy AirborneManager.kt and AirborneInitWorker.kt into the Android project
 */
const withAirborneNativeFiles = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { projectRoot, platformProjectRoot } = config.modRequest;

      const sourceDir = path.join(projectRoot, 'plugins', 'airborne-modules');
      const targetDir = path.join(
        platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        'net',
        'juspay',
        'xynespaces',
      );

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const files = ['AirborneManager.kt', 'AirborneInitWorker.kt'];

      for (const file of files) {
        const sourcePath = path.join(sourceDir, file);
        const targetPath = path.join(targetDir, file);

        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
        } else {
          console.warn(`[withAirborneAndroid] Source file not found: ${sourcePath}`);
        }
      }

      return config;
    },
  ]);
};

/**
 * Add AirborneReactNativeHost, AirborneManager, and FCM topic subscription to MainApplication.kt
 */
const withAirborneMainApplication = (config) => {
  return withMainApplication(config, (config) => {
    const { modResults } = config;
    let contents = modResults.contents;

    // Add AirborneReactNativeHost import
    if (!contents.includes('import `in`.juspay.airborneplugin.AirborneReactNativeHost')) {
      contents = contents.replace(
        'import expo.modules.ReactNativeHostWrapper',
        'import expo.modules.ReactNativeHostWrapper\nimport `in`.juspay.airborneplugin.AirborneReactNativeHost\nimport com.google.firebase.messaging.FirebaseMessaging',
      );
    }

    // Replace DefaultReactNativeHost with AirborneReactNativeHost
    if (
      contents.includes('DefaultReactNativeHost') &&
      !contents.includes('AirborneReactNativeHost(')
    ) {
      contents = contents.replace(
        /object\s*:\s*DefaultReactNativeHost\([^)]*\)/,
        'object : AirborneReactNativeHost(this@MainApplication)',
      );
      // Remove the now-unused import
      contents = contents.replace(
        /import com\.facebook\.react\.defaults\.DefaultReactNativeHost\n/,
        '',
      );
    }

    // Add AirborneManager singleton field
    if (!contents.includes('AirborneManager.getInstance()')) {
      contents = contents.replace(
        'class MainApplication : Application(), ReactApplication {',
        'class MainApplication : Application(), ReactApplication {\n\n  private val airborneManager = AirborneManager.getInstance()',
      );
    }

    // Add getJSBundleFile override to use Airborne bundle
    if (!contents.includes('getJSBundleFile')) {
      contents = contents.replace(
        'override fun getJSMainModuleName(): String',
        'override fun getJSBundleFile(): String? {\n          return airborneManager.airborne?.getBundlePath()\n        }\n\n        override fun getJSMainModuleName(): String',
      );
    }

    // Add asynchronous airborneManager.initialize() in onCreate after loadReactNative
    if (!contents.includes('airborneManager.initialize')) {
      contents = contents.replace(
        'loadReactNative(this)',
        'loadReactNative(this)\n    Thread {\n      airborneManager.initialize(applicationContext, BuildConfig.VERSION_NAME)\n      FirebaseMessaging.getInstance().subscribeToTopic("airborne_ota_lotus")\n    }.start()',
      );
    }

    // Add reactHost assignment after loadReactNative
    if (!contents.includes('airborneManager.reactHost')) {
      contents = contents.replace(
        'loadReactNative(this)\n    ApplicationLifecycleDispatcher',
        'loadReactNative(this)\n    airborneManager.reactHost = reactHost\n    ApplicationLifecycleDispatcher',
      );
    }

    modResults.contents = contents;
    return config;
  });
};

/**
 * Add OTA_Update handling to LotusIncomingCallMessagingService
 */
const withAirborneOtaInMessagingService = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { platformProjectRoot } = config.modRequest;

      const servicePath = path.join(
        platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        'net',
        'juspay',
        'xynespaces',
        'LotusIncomingCallMessagingService.kt',
      );

      let contents = readFileIfExists(servicePath);
      if (contents === null) {
        console.warn('[withAirborneAndroid] LotusIncomingCallMessagingService.kt not found');
        return config;
      }

      // Add WorkManager imports
      if (!contents.includes('import androidx.work.ExistingWorkPolicy')) {
        contents = contents.replace(
          'import org.json.JSONObject',
          'import org.json.JSONObject\nimport androidx.work.ExistingWorkPolicy\nimport androidx.work.OneTimeWorkRequestBuilder\nimport androidx.work.WorkManager',
        );
      }

      // Add OTA_Update handler before the type check
      if (!contents.includes('OTA_Update')) {
        const otaBlock = `\n    if (data.containsKey("OTA_Update")) {\n      Log.d(TAG, "OTA_Update payload received, enqueuing Airborne init worker")\n      val request = OneTimeWorkRequestBuilder<AirborneInitWorker>().build()\n      WorkManager.getInstance(applicationContext).enqueueUniqueWork(\n        AirborneInitWorker.WORK_NAME,\n        ExistingWorkPolicy.KEEP,\n        request\n      )\n      return\n    }\n`;
        // Insert before "val type = data["type"]"
        const typeCheckIdx = contents.indexOf('val type = data["type"]');
        if (typeCheckIdx !== -1) {
          contents = contents.slice(0, typeCheckIdx) + otaBlock + '\n    ' + contents.slice(typeCheckIdx);
        } else {
          // Fallback: insert after the empty data check return
          contents = contents.replace(
            /(Log\.d\(TAG,\s*"Empty data payload, ignoring"\)\s*\n\s*return\s*\n\s*\})/,
            '$1\n' + otaBlock,
          );
        }
      }

      fs.writeFileSync(servicePath, contents);
      return config;
    },
  ]);
};

/**
 * Replace DefaultReactActivityDelegate with AirborneReactActivityDelegate in MainActivity.kt
 */
const withAirborneMainActivity = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { platformProjectRoot } = config.modRequest;

      const activityPath = path.join(
        platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        'net',
        'juspay',
        'xynespaces',
        'MainActivity.kt',
      );

      let contents = readFileIfExists(activityPath);
      if (contents === null) {
        console.warn('[withAirborneAndroid] MainActivity.kt not found');
        return config;
      }

      if (!contents.includes('AirborneReactActivityDelegate')) {
        contents = contents.replace(
          'import com.facebook.react.defaults.DefaultReactActivityDelegate',
          'import `in`.juspay.airborneplugin.AirborneReactActivityDelegate',
        );

        contents = contents.replace(
          /object\s*:\s*DefaultReactActivityDelegate\(([\s\S]*?)\)\s*\{\s*\}/,
          'AirborneReactActivityDelegate($1)',
        );

        fs.writeFileSync(activityPath, contents);
      }

      return config;
    },
  ]);
};

/**
 * Add WorkManager dependency to build.gradle
 */
const withWorkManagerDependency = (config) => {
  return withAppBuildGradle(config, (config) => {
    const { modResults } = config;
    let contents = modResults.contents;

    const dependency = "implementation 'androidx.work:work-runtime-ktx:2.9.1'";

    if (!contents.includes(dependency)) {
      const dependenciesIndex = contents.indexOf('dependencies {');
      if (dependenciesIndex !== -1) {
        const insertIndex = contents.indexOf('\n', dependenciesIndex) + 1;
        contents =
          contents.slice(0, insertIndex) +
          `    ${dependency}\n` +
          contents.slice(insertIndex);
      }
    }

    modResults.contents = contents;
    return config;
  });
};

/**
 * Add Juspay maven repository to project-level build.gradle
 */
const withJuspayMavenRepo = (config) => {
  return withDangerousMod(config, [
    'android',
    async (config) => {
      const { platformProjectRoot } = config.modRequest;
      const buildGradlePath = path.join(platformProjectRoot, 'build.gradle');

      let contents = readFileIfExists(buildGradlePath);
      if (contents === null) {
        console.warn('[withAirborneAndroid] project build.gradle not found');
        return config;
      }

      const mavenUrl = 'https://maven.juspay.in/jp-build-packages/hyper-sdk/';
      const mavenRepoLine = `maven { url "${mavenUrl}" }`;
      // Idempotency: the quoted repo URL already present in any declaration form.
      const mavenRepoPresent = /["']https:\/\/maven\.juspay\.in\/jp-build-packages\/hyper-sdk\/["']/.test(
        contents,
      );

      if (!mavenRepoPresent) {
        contents = contents.replace(
          /(allprojects\s*\{\s*\n\s*repositories\s*\{)/,
          `$1\n    ${mavenRepoLine}`,
        );
        fs.writeFileSync(buildGradlePath, contents);
      }

      return config;
    },
  ]);
};

module.exports = (config) => {
  return withPlugins(config, [
    withAirborneNativeFiles,
    withAirborneMainApplication,
    withAirborneMainActivity,
    withAirborneOtaInMessagingService,
    withWorkManagerDependency,
    withJuspayMavenRepo,
  ]);
};
