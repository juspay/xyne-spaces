const {
  withAndroidManifest,
  withDangerousMod,
  withMainApplication,
  withMainActivity,
  withPlugins,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { getDefaultAndroidApplicationId } = require('../config/variants.cjs');

const PLUGIN = 'with-share-target-android';

function getAndroidPackage(config) {
  return config.android?.package || getDefaultAndroidApplicationId();
}

function javaRoot(platformProjectRoot, androidPackage) {
  return path.join(platformProjectRoot, 'app', 'src', 'main', 'java', ...androidPackage.split('.'));
}

function ensureShareIntentFilter(activity, action, mimeTypes) {
  activity['intent-filter'] ||= [];
  const existing = activity['intent-filter'].some(filter => {
    const actions = filter.action || [];
    return actions.some(a => a.$?.['android:name'] === action);
  });
  if (existing) return;

  activity['intent-filter'].push({
    action: [{ $: { 'android:name': action } }],
    category: [{ $: { 'android:name': 'android.intent.category.DEFAULT' } }],
    data: mimeTypes.map(mimeType => ({ $: { 'android:mimeType': mimeType } })),
  });
}

const withShareIntentFilters = config =>
  withAndroidManifest(config, cfg => {
    const app = cfg.modResults.manifest.application?.[0];
    const activities = app?.activity || [];
    const mainActivity = activities.find(
      activity => activity.$?.['android:name'] === '.MainActivity',
    );
    if (!mainActivity) throw new Error(`[${PLUGIN}] MainActivity not found`);

    mainActivity.$['android:exported'] = 'true';
    mainActivity.$['android:launchMode'] = 'singleTask';

    const mimeTypes = ['text/plain', 'image/*', 'video/*', 'audio/*', 'application/pdf', '*/*'];
    ensureShareIntentFilter(mainActivity, 'android.intent.action.SEND', mimeTypes);
    ensureShareIntentFilter(mainActivity, 'android.intent.action.SEND_MULTIPLE', mimeTypes);
    return cfg;
  });

const withShareTargetFiles = config =>
  withDangerousMod(config, [
    'android',
    async cfg => {
      const { projectRoot, platformProjectRoot } = cfg.modRequest;
      const pkg = getAndroidPackage(cfg);
      const sourceDir = path.join(projectRoot, 'plugins', 'android-modules', 'sharetarget');
      const targetDir = path.join(javaRoot(platformProjectRoot, pkg), 'sharetarget');
      fs.mkdirSync(targetDir, { recursive: true });
      for (const file of ['ShareTargetModule.kt', 'ShareTargetPackage.kt']) {
        fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file));
      }
      return cfg;
    },
  ]);

const withSharePackageRegistration = config => {
  const pkg = getAndroidPackage(config);
  return withMainApplication(config, cfg => {
    let contents = cfg.modResults.contents;
    const importLine = `import ${pkg}.sharetarget.ShareTargetPackage\n`;
    if (!contents.includes(importLine)) {
      contents = contents.replace(/^(package [^\n]+\n)/m, `$1\n${importLine}`);
    }
    if (!contents.includes('add(ShareTargetPackage())')) {
      contents = contents.replace(
        'PackageList(this).packages.apply {\n',
        'PackageList(this).packages.apply {\n              add(ShareTargetPackage())\n',
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });
};

const withMainActivitySetIntent = config =>
  withMainActivity(config, cfg => {
    let contents = cfg.modResults.contents;
    if (!contents.includes('setIntent(intent)')) {
      contents = contents.replace(
        'override fun onNewIntent(intent: android.content.Intent) {\n    super.onNewIntent(intent)',
        'override fun onNewIntent(intent: android.content.Intent) {\n    super.onNewIntent(intent)\n    setIntent(intent)',
      );
    }
    cfg.modResults.contents = contents;
    return cfg;
  });

module.exports = config =>
  withPlugins(config, [
    withShareIntentFilters,
    withShareTargetFiles,
    withSharePackageRegistration,
    withMainActivitySetIntent,
  ]);
