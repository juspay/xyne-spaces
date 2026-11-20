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
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, path.join(targetDir, fileName));
          console.log(`[${PLUGIN_NAME}] Copied transitkey/${fileName}`);
        } else {
          console.warn(`[${PLUGIN_NAME}] Source file not found: ${sourcePath}`);
        }
      }

      return config;
    },
  ]);
};

const withTransitKeyPackageRegistration = config => {
  const androidPackage = getAndroidApplicationPackage(config);

  return withMainApplication(config, cfg => {
    let src = cfg.modResults.contents;

    const importLine = `import ${androidPackage}.transitkey.TransitKeyPackage`;
    if (!src.includes(importLine)) {
      src = src.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
    }

    if (!src.includes('add(TransitKeyPackage())')) {
      src = src.replace(
        'PackageList(this).packages.apply {\n',
        'PackageList(this).packages.apply {\n              add(TransitKeyPackage())\n',
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
