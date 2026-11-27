const { withDangerousMod, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Adds the transit key module (plugins/android-modules/transitkey): the per-device ECDH key in
 * the Android Keystore that the encryption transit layer uses.
 */
const PLUGIN_NAME = 'with-transit-key-module-android';

const TRANSIT_KEY_FILES = ['TransitKeyModule.kt', 'TransitKeyPackage.kt'];

function toPackagePath(androidPackage) {
  return androidPackage.split('.').join(path.sep);
}

function getAndroidApplicationPackage(config) {
  return config.android?.package || 'net.juspay.xynespaces';
}

const withTransitKeyFiles = config => {
  return withDangerousMod(config, [
    'android',
    async config => {
      const { projectRoot, platformProjectRoot } = config.modRequest;

      const sourceDir = path.join(projectRoot, 'plugins', 'android-modules', 'transitkey');
      const targetDir = path.join(
        platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        toPackagePath(getAndroidApplicationPackage(config)),
        'transitkey',
      );

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const fileName of TRANSIT_KEY_FILES) {
        const sourcePath = path.join(sourceDir, fileName);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`[${PLUGIN_NAME}] Missing source file: ${sourcePath}`);
        }
        fs.copyFileSync(sourcePath, path.join(targetDir, fileName));
        console.log(`[${PLUGIN_NAME}] Copied transitkey/${fileName}`);
      }

      return config;
    },
  ]);
};

const withTransitKeyPackageRegistration = config => {
  const androidPackage = getAndroidApplicationPackage(config);

  return withMainApplication(config, cfg => {
    let src = cfg.modResults.contents;

    // A replace that finds no anchor changes nothing and the build still succeeds, with
    // LotusTransitKey missing at runtime, so each edit is checked and a miss fails prebuild.
    const importLine = `import ${androidPackage}.transitkey.TransitKeyPackage`;
    if (!src.includes(importLine)) {
      const withImport = src.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
      if (withImport === src) {
        throw new Error(
          `[${PLUGIN_NAME}] Failed to add the TransitKeyPackage import to MainApplication.kt. ` +
            `Expected a 'package …' line.`,
        );
      }
      src = withImport;
    }

    if (!src.includes('add(TransitKeyPackage())')) {
      src = src.replace(
        'PackageList(this).packages.apply {\n',
        'PackageList(this).packages.apply {\n              add(TransitKeyPackage())\n',
      );
    }
    if (!src.includes('add(TransitKeyPackage())')) {
      throw new Error(
        `[${PLUGIN_NAME}] Failed to register TransitKeyPackage in MainApplication.kt. ` +
          `Expected anchor 'PackageList(this).packages.apply {' not found.`,
      );
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};

module.exports = config => {
  config = withTransitKeyFiles(config);
  config = withTransitKeyPackageRegistration(config);
  return config;
};
