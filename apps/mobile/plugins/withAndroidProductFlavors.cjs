const os = require('os');
const {
  createRunOncePlugin,
  withAppBuildGradle,
  withGradleProperties,
} = require('@expo/config-plugins');
const { VARIANTS } = require('../config/variants.cjs');

const PLUGIN_NAME = 'with-android-product-flavors';
const PLUGIN_VERSION = '1.0.0';

/**
 * Insert string immediately after the Gradle `buildTypes { ... }` block (balanced braces).
 * @param {string} contents
 * @param {string} insert
 */
function insertAfterBuildTypes(contents, insert) {
  const needle = '\n    buildTypes {';
  const idx = contents.indexOf(needle);
  if (idx === -1) {
    throw new Error('[withAndroidProductFlavors] buildTypes block not found');
  }
  const openBrace = contents.indexOf('{', idx);
  let depth = 0;
  for (let j = openBrace; j < contents.length; j++) {
    const c = contents[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const after = j + 1;
        return contents.slice(0, after) + '\n' + insert + contents.slice(after);
      }
    }
  }
  throw new Error('[withAndroidProductFlavors] unclosed buildTypes');
}

/**
 * Ensure `react { debuggableVariants = [...] }` lists all *Debug flavors.
 * @param {string} contents
 */
function ensureReactDebuggableVariants(contents) {
  const variants = ['devDebug', 'prodDebug', 'sandboxDebug', 'communityDebug'];
  const line = `    debuggableVariants = [${variants.map(v => `"${v}"`).join(', ')}]`;

  // Match only a real assignment line, not `// debuggableVariants = ...` in the Expo template.
  if (/^\s*debuggableVariants\s*=\s*\[/m.test(contents)) {
    return contents.replace(/^\s*debuggableVariants\s*=\s*\[[^\]]*\]/m, line.trimEnd());
  }

  const reactOpen = contents.indexOf('\nreact {');
  if (reactOpen === -1) {
    throw new Error('[withAndroidProductFlavors] react { block not found');
  }
  const brace = contents.indexOf('{', reactOpen);
  let depth = 0;
  for (let j = brace; j < contents.length; j++) {
    const c = contents[j];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) {
        const inner = contents.slice(brace + 1, j);
        const injected = `\n${line}\n`;
        return contents.slice(0, brace + 1) + injected + inner + contents.slice(j);
      }
    }
  }
  throw new Error('[withAndroidProductFlavors] unclosed react block');
}

// Separate store app (APP_VARIANT=community). Signs like prod: release keystore for release builds,
// and for debug builds when the community prebuild sets LOTUS_PRODDEBUG_USE_RELEASE_SIGNING.
const COMMUNITY_FLAVOR = `        community {
            dimension "env"
            signingConfig ((Boolean.TRUE.equals(findProperty('LOTUS_PRODDEBUG_USE_RELEASE_SIGNING')) || 'true'.equalsIgnoreCase("\${findProperty('LOTUS_PRODDEBUG_USE_RELEASE_SIGNING') ?: ''}")) ? signingConfigs.release : signingConfigs.debug)
            applicationId "net.juspay.xynespacescommunity"
            manifestPlaceholders = [usesCleartextTraffic: "false"]
            resValue "string", "app_name", "Xyne Spaces"
        }`;

// Sandbox signs with its own keystore, kept outside the repo. Its SHA-1 + package name is what the
// sandbox Google Sign-In Android client is registered with. Set LOTUS_SANDBOX_STORE_FILE,
// _STORE_PASSWORD, _KEY_ALIAS and _KEY_PASSWORD in `.env.sandbox` (prebuild copies them into
// android/gradle.properties) or in ~/.gradle/gradle.properties. Without them sandbox falls back
// to the debug keystore, which builds but cannot use Google Sign-In.
const SANDBOX_SIGNING_MARKER = 'LOTUS_SANDBOX_STORE_FILE';
const SANDBOX_SIGNING_CONFIG = `    signingConfigs {
        sandbox {
            if (findProperty('LOTUS_SANDBOX_STORE_FILE')) {
                storeFile file(findProperty('LOTUS_SANDBOX_STORE_FILE'))
                storePassword findProperty('LOTUS_SANDBOX_STORE_PASSWORD')
                keyAlias findProperty('LOTUS_SANDBOX_KEY_ALIAS')
                keyPassword findProperty('LOTUS_SANDBOX_KEY_PASSWORD')
            }
        }
    }`;
const SANDBOX_SIGNING = `(findProperty('LOTUS_SANDBOX_STORE_FILE') ? signingConfigs.sandbox : signingConfigs.debug)`;

const SANDBOX_FLAVOR = `        sandbox {
            dimension "env"
            signingConfig ${SANDBOX_SIGNING}
            applicationId "${VARIANTS.sandbox.androidApplicationId}"
            manifestPlaceholders = [usesCleartextTraffic: "false"]
            versionNameSuffix "-sandbox"
            resValue "string", "app_name", "Xyne Spaces Sandbox"
        }`;

// buildTypes.release signs with the prod key and a build type's key wins over a flavor's, so
// sandboxRelease would otherwise be signed with prod's key. Set the key per variant instead.
const SANDBOX_VARIANT_SIGNING = `
androidComponents {
    onVariants(selector().withFlavor(new kotlin.Pair("env", "sandbox"))) { variant ->
        variant.signingConfig.setConfig(findProperty('LOTUS_SANDBOX_STORE_FILE') ? android.signingConfigs.sandbox : android.signingConfigs.debug)
    }
}
if (!findProperty('LOTUS_SANDBOX_STORE_FILE')) {
    logger.warn("LOTUS_SANDBOX_STORE_FILE is not set: sandbox builds use the debug keystore, so Google Sign-In will not work.")
}
`;

/**
 * Moves an android/ project prebuilt with the old sandbox flavor (prod package, debug key) to the
 * sandbox package and keystore.
 * @param {string} contents
 */
function ensureSandboxSigning(contents) {
  if (contents.includes(SANDBOX_SIGNING_MARKER)) {
    return contents;
  }
  const oldFlavor = /^ {8}sandbox \{\n(?: {12}.*\n)*? {8}\}/m;
  if (!oldFlavor.test(contents)) {
    throw new Error('[withAndroidProductFlavors] sandbox flavor not found');
  }
  const flavors = contents.indexOf('\n    flavorDimensions');
  return (
    contents.slice(0, flavors) +
    '\n' +
    SANDBOX_SIGNING_CONFIG +
    contents.slice(flavors).replace(oldFlavor, SANDBOX_FLAVOR) +
    SANDBOX_VARIANT_SIGNING
  );
}

const SANDBOX_SIGNING_KEYS = [
  'LOTUS_SANDBOX_STORE_FILE',
  'LOTUS_SANDBOX_STORE_PASSWORD',
  'LOTUS_SANDBOX_KEY_ALIAS',
  'LOTUS_SANDBOX_KEY_PASSWORD',
];

/**
 * Copies the sandbox keystore settings from the loaded `.env.<variant>` into
 * android/gradle.properties, like withAndroidReleaseSigning does for `LOTUS_RELEASE_*`. A value
 * from the env file replaces the stored one; keys the env file leaves unset are kept.
 */
function withSandboxSigningProperties(config) {
  return withGradleProperties(config, cfg => {
    for (const key of SANDBOX_SIGNING_KEYS) {
      let value = process.env[key]?.trim();
      if (!value) continue;
      if (key === 'LOTUS_SANDBOX_STORE_FILE' && value.startsWith('~/')) {
        value = `${os.homedir()}${value.slice(1)}`;
      }
      cfg.modResults = cfg.modResults.filter(p => !(p.type === 'property' && p.key === key));
      cfg.modResults.push({ type: 'property', key, value });
    }
    return cfg;
  });
}

/** Adds the community flavor to an android/ project prebuilt before it existed. */
function ensureCommunityFlavor(contents) {
  if (/^\s*community\s*\{/m.test(contents)) {
    return contents;
  }
  const flavorsOpen = contents.indexOf('productFlavors {');
  if (flavorsOpen === -1) {
    return contents;
  }
  const insertAt = contents.indexOf('{', flavorsOpen) + 1;
  return `${contents.slice(0, insertAt)}\n${COMMUNITY_FLAVOR}${contents.slice(insertAt)}`;
}

function flavorBlock() {
  // defaultConfig.applicationId should be prod (from Expo android.package).
  // dev flavor overrides full applicationId for local / dev registration.
  return `
${SANDBOX_SIGNING_CONFIG}
    flavorDimensions "env"
    productFlavors {
        dev {
            dimension "env"
            signingConfig signingConfigs.debug
            applicationId "net.juspay.xyne.spaces"
            versionNameSuffix "-dev"
            manifestPlaceholders = [usesCleartextTraffic: "true"]
            resValue "string", "app_name", "Xyne Spaces Dev"
        }
        prod {
            dimension "env"
            signingConfig ((Boolean.TRUE.equals(findProperty('LOTUS_PRODDEBUG_USE_RELEASE_SIGNING')) || 'true'.equalsIgnoreCase("\${findProperty('LOTUS_PRODDEBUG_USE_RELEASE_SIGNING') ?: ''}")) ? signingConfigs.release : signingConfigs.debug)
            manifestPlaceholders = [usesCleartextTraffic: "false"]
            resValue "string", "app_name", "Xyne Spaces"
        }
${SANDBOX_FLAVOR}
${COMMUNITY_FLAVOR}
    }`;
}

function withAndroidProductFlavors(config) {
  config = withSandboxSigningProperties(config);
  return withAppBuildGradle(config, cfg => {
    if (cfg.modResults.language !== 'groovy') {
      return cfg;
    }
    let contents = cfg.modResults.contents;
    if (contents.includes('flavorDimensions')) {
      cfg.modResults.contents = ensureReactDebuggableVariants(
        ensureSandboxSigning(ensureCommunityFlavor(contents)),
      );
      return cfg;
    }
    contents = insertAfterBuildTypes(contents, flavorBlock()) + SANDBOX_VARIANT_SIGNING;
    contents = ensureReactDebuggableVariants(contents);
    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = createRunOncePlugin(withAndroidProductFlavors, PLUGIN_NAME, PLUGIN_VERSION);
