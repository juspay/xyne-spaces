const { createRunOncePlugin, withAppBuildGradle } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-android-app-config';
const PLUGIN_VERSION = '1.0.0';

// Use the standard generated debug keystore by default. Custom debug signing
// remains available through the local-only Gradle property, but no repository
// signing material is required for a clean public clone.
const DEBUG_KEYSTORE_PATH = "findProperty('LOTUS_DEBUG_KEYSTORE_FILE') ?: 'debug.keystore'";

function resolveRemoteLoggingBuildValues(config) {
  const raw = String(
    config.extra?.lotusRemoteLoggingEnabled ?? process.env.LOTUS_REMOTE_LOGGING_ENABLED ?? '',
  )
    .trim()
    .toLowerCase();
  // Matches isRemoteLoggingEnabled() in src/config.ts: the community store app is a
  // production variant too.
  const isProductionVariant = ['prod', 'community'].includes(config.extra?.appVariant);

  return {
    defaultEnabled: raw === 'true',
    releaseEnabled: raw === 'false' ? false : isProductionVariant,
  };
}

function findNamedBlock(contents, name, searchStart = 0, searchEnd = contents.length) {
  const blockPattern = new RegExp(`^[ \\t]*${name}\\s*\\{`, 'm');
  const match = blockPattern.exec(contents.slice(searchStart, searchEnd));
  if (!match) return null;

  const matchStart = searchStart + match.index;
  const openingBrace = contents.indexOf('{', matchStart);
  let depth = 0;
  for (let index = openingBrace; index < searchEnd; index += 1) {
    if (contents[index] === '{') depth += 1;
    if (contents[index] !== '}') continue;
    depth -= 1;
    if (depth === 0) {
      return {
        bodyStart: openingBrace + 1,
        end: index,
      };
    }
  }

  throw new Error(`[with-android-app-config] unclosed ${name} block`);
}

function upsertRemoteLoggingField(contents, block, field) {
  const body = contents.slice(block.bodyStart, block.end);
  const existingPattern =
    /^[ \t]*buildConfigField\s+"boolean",\s+"REMOTE_LOGGING_ENABLED",\s+"(?:true|false)"\s*$/m;
  const existing = existingPattern.exec(body);
  if (existing) {
    const start = block.bodyStart + existing.index;
    return contents.slice(0, start) + field + contents.slice(start + existing[0].length);
  }

  return contents.slice(0, block.bodyStart) + `\n${field}` + contents.slice(block.bodyStart);
}

function addRemoteLoggingBuildConfigFields(contents, config) {
  const { defaultEnabled, releaseEnabled } = resolveRemoteLoggingBuildValues(config);
  const defaultField = `        buildConfigField "boolean", "REMOTE_LOGGING_ENABLED", "${defaultEnabled}"`;
  const releaseField = `            buildConfigField "boolean", "REMOTE_LOGGING_ENABLED", "${releaseEnabled}"`;

  const defaultConfig = findNamedBlock(contents, 'defaultConfig');
  if (!defaultConfig) {
    throw new Error('[with-android-app-config] defaultConfig block not found');
  }
  contents = upsertRemoteLoggingField(contents, defaultConfig, defaultField);

  const buildTypes = findNamedBlock(contents, 'buildTypes');
  if (!buildTypes) {
    throw new Error('[with-android-app-config] buildTypes block not found');
  }
  const release = findNamedBlock(contents, 'release', buildTypes.bodyStart, buildTypes.end);
  if (!release) {
    throw new Error('[with-android-app-config] release build type not found');
  }
  contents = upsertRemoteLoggingField(contents, release, releaseField);

  return contents;
}

function withAndroidAppConfig(config) {
  return withAppBuildGradle(config, config => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }

    let contents = config.modResults.contents;

    contents = addRemoteLoggingBuildConfigFields(contents, config);

    contents = contents.replace(
      /storeFile\s+file\('[^']*'\)/,
      `storeFile file(${DEBUG_KEYSTORE_PATH})`,
    );

    contents = contents.replace(
      /storePassword\s+'[^']*'/,
      "storePassword (findProperty('LOTUS_DEBUG_KEYSTORE_PASSWORD') ?: 'android')",
    );

    contents = contents.replace(
      /keyAlias\s+'[^']*'/,
      "keyAlias (findProperty('LOTUS_DEBUG_KEY_ALIAS') ?: 'androiddebugkey')",
    );

    contents = contents.replace(
      /keyPassword\s+'[^']*'/,
      "keyPassword (findProperty('LOTUS_DEBUG_KEY_PASSWORD') ?: 'android')",
    );

    // Add Firebase Messaging dependency for LotusIncomingCallMessagingService
    const firebaseDep = "implementation 'com.google.firebase:firebase-messaging:24.0.0'";
    if (!contents.includes('firebase-messaging')) {
      contents = contents.replace(/dependencies\s*\{/, `dependencies {\n    ${firebaseDep}`);
    }

    // Add Firebase Crashlytics SDK dependency used by LotusCrashReporterModule
    // and generated native call service files.
    const crashlyticsDep = 'implementation("com.google.firebase:firebase-crashlytics")';
    if (!contents.includes('firebase-crashlytics')) {
      contents = contents.replace(/dependencies\s*\{/, `dependencies {\n    ${crashlyticsDep}`);
    }

    const { patchAppBuildGradleForReleaseSigning } = require('./withAndroidReleaseSigning.cjs');
    contents = patchAppBuildGradleForReleaseSigning(contents);

    // Inject the Firebase Crashlytics Gradle plugin if not already applied.
    if (!contents.includes('apply plugin: "com.google.firebase.crashlytics"')) {
      contents = contents.replace(
        /apply plugin: "com\.facebook\.react"\n/,
        `apply plugin: "com.facebook.react"\napply plugin: "com.google.firebase.crashlytics"\n`,
      );
    }

    // Inject firebaseCrashlytics into the release buildType
    if (!contents.includes('firebaseCrashlytics')) {
      const releaseBlockEnd =
        /(\s*release\s*\{[\s\S]*?crunchPngs\s+enablePngCrunchInRelease\.toBoolean\(\)\n)(\s*\})/;
      contents = contents.replace(
        releaseBlockEnd,
        `$1            firebaseCrashlytics {\n                mappingFileUploadEnabled true\n                nativeSymbolUploadEnabled true\n                // Flavour-aware path: the app's release variant is prodRelease,\n                // so AGP writes unstripped libs under prodRelease/mergeProdReleaseNativeLibs.\n                // The old unflavoured 'release/out/lib' path never existed ->\n                // nativeSymbolUploadEnabled silently found nothing.\n                unstrippedNativeLibsDir 'build/intermediates/merged_native_libs/prodRelease/mergeProdReleaseNativeLibs/out/lib'\n            }\n            ndk {\n                // Bundle full native symbols into the AAB so Play Console can\n                // symbolicate native crashes (libreactnative, libhermesvm, etc.)\n                debugSymbolLevel 'FULL'\n            }\n$2`,
      );
    }

    config.modResults.contents = contents;
    return config;
  });
}

module.exports = createRunOncePlugin(withAndroidAppConfig, PLUGIN_NAME, PLUGIN_VERSION);
