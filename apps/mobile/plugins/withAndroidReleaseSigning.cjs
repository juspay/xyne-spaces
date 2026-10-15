const { createRunOncePlugin, withGradleProperties } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-android-release-signing';
const PLUGIN_VERSION = '1.0.0';

// Keystore defaults per store app (main vs community); `LOTUS_RELEASE_*` still override them.
const { androidReleaseStoreFile: DEFAULT_STORE_FILE, androidReleaseKeyAlias: DEFAULT_KEY_ALIAS } =
  require('../config/variants.cjs').getPrebuildVariant();

/** Matches manual Lotus setup; do not commit real passwords — use local `gradle.properties` or env. */
const RELEASE_BLOCK = `        release {
            storeFile file(findProperty('LOTUS_RELEASE_STORE_FILE') ?: '${DEFAULT_STORE_FILE}')
            storePassword (findProperty('LOTUS_RELEASE_STORE_PASSWORD') ?: System.getenv('LOTUS_RELEASE_STORE_PASSWORD') ?: '')
            keyAlias (findProperty('LOTUS_RELEASE_KEY_ALIAS') ?: '${DEFAULT_KEY_ALIAS}')
            keyPassword (findProperty('LOTUS_RELEASE_KEY_PASSWORD') ?: System.getenv('LOTUS_RELEASE_KEY_PASSWORD') ?: '')
        }`;

const DEBUG_BLOCK_END =
  "            keyPassword (findProperty('LOTUS_DEBUG_KEY_PASSWORD') ?: 'android')\n        }\n    }\n    buildTypes {";

const SIGNING_CLOSE_DEBUG_BUILD_TYPES = `            keyPassword (findProperty('LOTUS_DEBUG_KEY_PASSWORD') ?: 'android')
        }
${RELEASE_BLOCK}
    }
    buildTypes {`;

/** Legacy `afterEvaluate { variant.signingConfig = … }` — fails on AGP 8+ (read-only). Strip if still present. */
const LEGACY_PRODDEBUG_AFTER_EVALUATE =
  /\n\/\/ \[Lotus\] prodDebug uses release signing when[\s\S]*?variant\.signingConfig = android\.signingConfigs\.release\n {8}\}\n {4}\}\n\}\n/;

const CLOSE_DEBUG_THEN_BUILD_TYPES = '\n        }\n    }\n    buildTypes {';
const DEBUG_KEYPASSWORD_LOTUS =
  "            keyPassword (findProperty('LOTUS_DEBUG_KEY_PASSWORD') ?: 'android')" + CLOSE_DEBUG_THEN_BUILD_TYPES;
const DEBUG_KEYPASSWORD_EXPO_DEFAULT = "            keyPassword 'android'" + CLOSE_DEBUG_THEN_BUILD_TYPES;

function isProdPrebuild() {
  try {
    const { resolveVariantKey, isProductionLikeVariant } = require('../config/variants.cjs');
    return isProductionLikeVariant(resolveVariantKey(process.env.APP_VARIANT));
  } catch {
    return process.env.APP_VARIANT === 'prod' || process.env.APP_VARIANT === 'community';
  }
}

/** Insert `signingConfigs.release` after `debug` when missing (handles stale android/ or plugin order quirks). */
function ensureReleaseSigningBlock(contents) {
  if (/signingConfigs\s*\{[\s\S]*?\brelease\s*\{/.test(contents)) {
    return contents;
  }
  if (contents.includes(DEBUG_KEYPASSWORD_LOTUS)) {
    return contents.replace(
      DEBUG_KEYPASSWORD_LOTUS,
      `            keyPassword (findProperty('LOTUS_DEBUG_KEY_PASSWORD') ?: 'android')
        }
${RELEASE_BLOCK}
    }
    buildTypes {`,
    );
  }
  if (contents.includes(DEBUG_KEYPASSWORD_EXPO_DEFAULT)) {
    return contents.replace(
      DEBUG_KEYPASSWORD_EXPO_DEFAULT,
      `            keyPassword 'android'
        }
${RELEASE_BLOCK}
    }
    buildTypes {`,
    );
  }
  return contents;
}

/**
 * Patch `android/app/build.gradle` for release signing and prodDebug upload-keystore behavior.
 *
 * **AGP 8+:** `variant.signingConfig = …` in `afterEvaluate` fails (read-only). We clear `buildTypes.debug`
 * signing and set `signingConfig` on each `productFlavor` instead; `prod` uses
 * `LOTUS_PRODDEBUG_USE_RELEASE_SIGNING` to pick release vs debug for **prodDebug** only. **prodRelease** still
 * uses `buildTypes.release` (release signing wins over flavor when both are set).
 */
function patchAppBuildGradleForReleaseSigning(contents) {
  let c = contents;

  c = c.replace(LEGACY_PRODDEBUG_AFTER_EVALUATE, '\n');

  const OLD_RELEASE_BLOCK =
    "        release {\n" +
    "            def releaseStoreFile = findProperty('LOTUS_RELEASE_STORE_FILE')\n" +
    '            if (releaseStoreFile) {\n' +
    '                storeFile file(releaseStoreFile)\n' +
    "                storePassword (findProperty('LOTUS_RELEASE_STORE_PASSWORD') ?: System.getenv('LOTUS_RELEASE_STORE_PASSWORD') ?: '')\n" +
    "                keyAlias (findProperty('LOTUS_RELEASE_KEY_ALIAS') ?: '')\n" +
    "                keyPassword (findProperty('LOTUS_RELEASE_KEY_PASSWORD') ?: System.getenv('LOTUS_RELEASE_KEY_PASSWORD') ?: '')\n" +
    '            }\n' +
    '        }';

  if (c.includes(OLD_RELEASE_BLOCK)) {
    c = c.replace(OLD_RELEASE_BLOCK, RELEASE_BLOCK);
  } else if (c.includes(DEBUG_BLOCK_END)) {
    c = c.replace(DEBUG_BLOCK_END, SIGNING_CLOSE_DEBUG_BUILD_TYPES);
  } else {
    c = ensureReleaseSigningBlock(c);
  }

  c = c.replace(
    /signingConfig \(findProperty\('LOTUS_RELEASE_STORE_FILE'\) \? signingConfigs\.release : signingConfigs\.debug\)/,
    'signingConfig signingConfigs.release',
  );
  c = c.replace(
    /signingConfig signingConfigs\.debug\n(\s+)def enableShrinkResources/s,
    'signingConfig signingConfigs.release\n$1def enableShrinkResources',
  );

  // AGP attaches the default debug keystore to build type `debug`, which overrides productFlavor signing.
  // Clear it so dev/sandbox/prod can each set signingConfig on the flavor (prod → upload cert when flag true).
  if (!/buildTypes\s*\{[\s\S]*?\bdebug\s*\{[^}]*\bsigningConfig\s+null\b/.test(c)) {
    c = c.replace(
      /(\n {4}buildTypes \{\n {8}debug \{\n)[\s\S]*?(\n {8}release \{)/,
      `$1            // Required so productFlavor signing is not overridden by AGP's default debug keystore.\n            signingConfig null\n        }$2`,
    );
  }

  const prodFlavorSigning =
    'signingConfig ((Boolean.TRUE.equals(findProperty(\'LOTUS_PRODDEBUG_USE_RELEASE_SIGNING\')) || \'true\'.equalsIgnoreCase("${findProperty(\'LOTUS_PRODDEBUG_USE_RELEASE_SIGNING\') ?: \'\'}")) ? signingConfigs.release : signingConfigs.debug)';
  const prodLegacyPatterns = [
    "signingConfig (findProperty('LOTUS_PRODDEBUG_USE_RELEASE_SIGNING') == 'true' ? signingConfigs.release : signingConfigs.debug)",
    "signingConfig (((findProperty('LOTUS_PRODDEBUG_USE_RELEASE_SIGNING') ?: '').toString().trim().equalsIgnoreCase('true')) ? signingConfigs.release : signingConfigs.debug)",
    'signingConfig signingConfigs.release',
  ];
  for (const legacy of prodLegacyPatterns) {
    if (legacy === 'signingConfig signingConfigs.release') {
      c = c.replace(
        /(\n {8}prod \{\n\s*dimension\s+["']env["']\s*\n)\s*signingConfig signingConfigs\.release\n(\s*manifestPlaceholders)/,
        `$1            ${prodFlavorSigning}\n$2`,
      );
    } else {
      c = c.replace(legacy, prodFlavorSigning);
    }
  }
  if (!c.includes(prodFlavorSigning)) {
    c = c.replace(
      /( {8}prod\s*\{\s*\n\s*dimension\s+["']env["']\s*\n)/,
      `$1            ${prodFlavorSigning}\n`,
    );
  }

  if (!/dev\s*\{[\s\S]*?signingConfig signingConfigs\.debug/.test(c)) {
    c = c.replace(/( {8}dev\s*\{\s*\n\s*dimension\s+["']env["']\s*\n)/, `$1            signingConfig signingConfigs.debug\n`);
  }
  if (!/sandbox\s*\{[\s\S]*?signingConfig signingConfigs\.debug/.test(c)) {
    c = c.replace(
      /( {8}sandbox\s*\{\s*\n\s*dimension\s+["']env["']\s*\n)/,
      `$1            signingConfig signingConfigs.debug\n`,
    );
  }

  return c;
}

/**
 * Persist release keystore wiring across `expo prebuild` (replaces manual edits to `build.gradle` / `gradle.properties`).
 *
 * Prebuild writes these keys into `android/gradle.properties`. Values come from the existing file first,
 * then from `process.env` (set `LOTUS_RELEASE_*` in `.env.dev` / `.env.prod` / `.env.sandbox` — loaded by
 * `loadLotusEnv` before prebuild). Do not commit real secrets in the repo; keep `.env.*` out of git if needed.
 *
 * **prodDebug + prod data:** `pnpm run prebuild:prod` sets `LOTUS_PRODDEBUG_USE_RELEASE_SIGNING=true`. The **prod** flavor
 * then uses `signingConfigs.release` for debug builds; **dev** / **sandbox** stay on the debug keystore. Patched from
 * `withAndroidAppConfig` (last on the `appBuildGradle` mod chain).
 */
function withAndroidReleaseSigning(config) {
  return withGradleProperties(config, cfg => {
    const props = cfg.modResults;
    const defaultStoreRel = DEFAULT_STORE_FILE;
    const lotusKeys = [
      'LOTUS_RELEASE_STORE_PASSWORD',
      'LOTUS_RELEASE_KEY_ALIAS',
      'LOTUS_RELEASE_KEY_PASSWORD',
    ];
    const getVal = key => {
      const item = props.find(p => p.type === 'property' && p.key === key);
      return item?.value;
    };
    const storePassword =
      getVal('LOTUS_RELEASE_STORE_PASSWORD') || process.env.LOTUS_RELEASE_STORE_PASSWORD || '';
    const keyAlias =
      getVal('LOTUS_RELEASE_KEY_ALIAS') ||
      process.env.LOTUS_RELEASE_KEY_ALIAS ||
      DEFAULT_KEY_ALIAS;
    const keyPassword =
      getVal('LOTUS_RELEASE_KEY_PASSWORD') || process.env.LOTUS_RELEASE_KEY_PASSWORD || '';

    cfg.modResults = props.filter(
      p =>
        !(
          (p.type === 'property' &&
            p.key === 'LOTUS_RELEASE_STORE_FILE' &&
            p.value === defaultStoreRel) ||
          (p.type === 'property' && lotusKeys.includes(p.key))
        ),
    );

    cfg.modResults.push(
      { type: 'property', key: 'LOTUS_RELEASE_STORE_PASSWORD', value: storePassword },
      { type: 'property', key: 'LOTUS_RELEASE_KEY_ALIAS', value: keyAlias },
      { type: 'property', key: 'LOTUS_RELEASE_KEY_PASSWORD', value: keyPassword },
    );

    if (isProdPrebuild()) {
      const existingFlag = getVal('LOTUS_PRODDEBUG_USE_RELEASE_SIGNING');
      const flagValue = existingFlag !== undefined ? existingFlag : 'true';
      cfg.modResults = cfg.modResults.filter(
        p => !(p.type === 'property' && p.key === 'LOTUS_PRODDEBUG_USE_RELEASE_SIGNING'),
      );
      cfg.modResults.push({
        type: 'property',
        key: 'LOTUS_PRODDEBUG_USE_RELEASE_SIGNING',
        value: flagValue,
      });
    }

    return cfg;
  });
}

const plugin = createRunOncePlugin(withAndroidReleaseSigning, PLUGIN_NAME, PLUGIN_VERSION);
plugin.patchAppBuildGradleForReleaseSigning = patchAppBuildGradleForReleaseSigning;
module.exports = plugin;
