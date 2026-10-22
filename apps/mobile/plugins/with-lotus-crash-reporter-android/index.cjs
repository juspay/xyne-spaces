const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'with-lotus-crash-reporter-android';

function toPackagePath(androidPackage) {
  return androidPackage.split('.').join(path.sep);
}

function getAndroidApplicationPackage(config) {
  return config.android?.package || 'net.juspay.xynespaces';
}

/**
 * Copy LotusCrashReporter Kotlin sources from plugins/android-modules/ into the
 * Android project under the correct Java package tree.
 */
const withCrashReporterFiles = config => {
  return withDangerousMod(config, [
    'android',
    async config => {
      const { modRequest } = config;
      const { projectRoot, platformProjectRoot } = modRequest;
      const androidPackage = getAndroidApplicationPackage(config);

      const sourceDir = path.join(projectRoot, 'plugins', 'android-modules');
      const packagePath = toPackagePath(androidPackage);
      const targetDir = path.join(
        platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        packagePath,
        'crashreporter',
      );

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const files = [
        {
          source: path.join('crashreporter', 'LotusCrashReporterModule.kt'),
          target: path.join(targetDir, 'LotusCrashReporterModule.kt'),
        },
        {
          source: path.join('crashreporter', 'LotusCrashReporterPackage.kt'),
          target: path.join(targetDir, 'LotusCrashReporterPackage.kt'),
        },
        {
          source: path.join('crashreporter', 'CrashlyticsStartupPolicy.kt'),
          target: path.join(targetDir, 'CrashlyticsStartupPolicy.kt'),
        },
      ];

      for (const { source, target } of files) {
        const sourcePath = path.join(sourceDir, source);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, target);
          console.log(`[${PLUGIN_NAME}] Copied ${source}`);
        } else {
          console.warn(`[${PLUGIN_NAME}] Source file not found: ${sourcePath}`);
        }
      }

      return config;
    },
  ]);
};

/**
 * Register LotusCrashReporterPackage in MainApplication.kt.
 */
const withCrashReporterPackageRegistration = config => {
  const androidPackage = getAndroidApplicationPackage(config);

  return withMainApplication(config, cfg => {
    let src = cfg.modResults.contents;

    const importLine = `import ${androidPackage}.crashreporter.LotusCrashReporterPackage`;
    if (!src.includes(importLine)) {
      src = src.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
    }

    if (!src.includes('add(LotusCrashReporterPackage())')) {
      src = src.replace(
        'PackageList(this).packages.apply {\n',
        'PackageList(this).packages.apply {\n              add(LotusCrashReporterPackage())\n',
      );
    }

    if (!src.includes('add(LotusCrashReporterPackage())')) {
      throw new Error(
        `[${PLUGIN_NAME}] Failed to inject LotusCrashReporterPackage into MainApplication.kt. ` +
          `Expected anchor 'PackageList(this).packages.apply {' not found.`,
      );
    }

    const startupPolicyImport = `import ${androidPackage}.crashreporter.CrashlyticsStartupPolicy`;
    if (!src.includes(startupPolicyImport)) {
      src = src.replace(/^(package [^\n]+\n)/m, `$1\n${startupPolicyImport}\n`);
    }

    const startupPolicyCall = '    CrashlyticsStartupPolicy.apply(this)';
    if (!src.includes(startupPolicyCall)) {
      const onCreateAnchor = '  override fun onCreate()';
      if (!src.includes(onCreateAnchor)) {
        throw new Error(
          `[${PLUGIN_NAME}] Failed to inject Crashlytics startup policy. ` +
            `Expected anchor 'override fun onCreate()' not found.`,
        );
      }
      src = src.replace(
        onCreateAnchor,
        `  override fun attachBaseContext(base: android.content.Context) {\n` +
          `    super.attachBaseContext(base)\n` +
          `    CrashlyticsStartupPolicy.apply(base)\n` +
          `  }\n\n` +
          onCreateAnchor,
      );
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};

function withLotusCrashReporterAndroid(config) {
  config = withCrashReporterFiles(config);
  config = withCrashReporterPackageRegistration(config);
  return config;
}

// NOTE: createRunOncePlugin removed — it was causing the plugin to be skipped
// during prebuild even with --clean. The plugin is listed once in app.json
// so running once per prebuild is the natural behavior.
module.exports = withLotusCrashReporterAndroid;
