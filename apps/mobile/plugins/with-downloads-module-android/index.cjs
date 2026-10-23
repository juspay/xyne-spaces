const {
  withDangerousMod,
  withMainApplication,
  withAndroidManifest,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const PLUGIN_NAME = 'with-downloads-module-android';

function toPackagePath(androidPackage) {
  return androidPackage.split('.').join(path.sep);
}

function getAndroidApplicationPackage(config) {
  return config.android?.package || 'net.juspay.xynespaces';
}

const DOWNLOAD_FILES = [
  'DownloadsModule.kt',
  'DownloadsPackage.kt',
  'AttachmentDownloadJob.kt',
  'AttachmentDownloadStore.kt',
  'AttachmentDownloadNotifier.kt',
  'AttachmentDownloadReceiver.kt',
  'AttachmentDownloadService.kt',
  'AttachmentDownloadModule.kt',
  'AttachmentDownloadAuth.kt',
  'OpenDownloadedFileActivity.kt',
];

const withDownloadsFiles = config => {
  return withDangerousMod(config, [
    'android',
    async config => {
      const { modRequest } = config;
      const { projectRoot, platformProjectRoot } = modRequest;

      const sourceDir = path.join(projectRoot, 'plugins', 'android-modules');
      const targetDir = path.join(
        platformProjectRoot,
        'app',
        'src',
        'main',
        'java',
        toPackagePath(getAndroidApplicationPackage(config)),
        'downloads',
      );

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const fileName of DOWNLOAD_FILES) {
        const sourcePath = path.join(sourceDir, 'downloads', fileName);
        const targetPath = path.join(targetDir, fileName);
        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`[${PLUGIN_NAME}] Copied downloads/${fileName}`);
        } else {
          console.warn(`[${PLUGIN_NAME}] Source file not found: ${sourcePath}`);
        }
      }

      return config;
    },
  ]);
};

const withDownloadsManifest = config => {
  return withAndroidManifest(config, cfg => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application?.[0];
    if (!app) return cfg;

    app.service = app.service ?? [];
    if (!app.service.some(s => s.$?.['android:name'] === '.downloads.AttachmentDownloadService')) {
      app.service.push({
        $: {
          'android:name': '.downloads.AttachmentDownloadService',
          'android:exported': 'false',
          'android:foregroundServiceType': 'dataSync',
        },
      });
    }

    app.receiver = app.receiver ?? [];
    if (!app.receiver.some(r => r.$?.['android:name'] === '.downloads.AttachmentDownloadReceiver')) {
      app.receiver.push({
        $: {
          'android:name': '.downloads.AttachmentDownloadReceiver',
          'android:exported': 'false',
        },
      });
    }

    app.activity = app.activity ?? [];
    if (!app.activity.some(a => a.$?.['android:name'] === '.downloads.OpenDownloadedFileActivity')) {
      app.activity.push({
        $: {
          'android:name': '.downloads.OpenDownloadedFileActivity',
          'android:exported': 'false',
          'android:excludeFromRecents': 'true',
          'android:noHistory': 'true',
          'android:theme': '@android:style/Theme.Translucent.NoTitleBar',
        },
      });
    }

    return cfg;
  });
};

const withDownloadsPackageRegistration = config => {
  const androidPackage = getAndroidApplicationPackage(config);

  return withMainApplication(config, cfg => {
    let src = cfg.modResults.contents;

    const importLine = `import ${androidPackage}.downloads.DownloadsPackage`;
    if (!src.includes(importLine)) {
      src = src.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}\n`);
    }

    if (!src.includes('add(DownloadsPackage())')) {
      src = src.replace(
        'PackageList(this).packages.apply {\n',
        'PackageList(this).packages.apply {\n              add(DownloadsPackage())\n',
      );
    }

    const restoreImport = `import ${androidPackage}.downloads.AttachmentDownloadService`;
    if (!src.includes(restoreImport)) {
      src = src.replace(/^(package [^\n]+\n)/m, `$1\n${restoreImport}\n`);
    }

    if (!src.includes('AttachmentDownloadService.restore(this)')) {
      const restoreLine = '    AttachmentDownloadService.restore(this)';
      const onCreateMatch = src.match(/override fun onCreate\(\) \{\n {4}super\.onCreate\(\)\n/);
      if (onCreateMatch) {
        src = src.replace(
          onCreateMatch[0],
          `${onCreateMatch[0]}${restoreLine}\n`,
        );
      } else {
        console.warn(
          `[${PLUGIN_NAME}] MainApplication.kt: could not inject AttachmentDownloadService.restore`,
        );
      }
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};

module.exports = config => {
  config = withDownloadsFiles(config);
  config = withDownloadsManifest(config);
  config = withDownloadsPackageRegistration(config);
  return config;
};
