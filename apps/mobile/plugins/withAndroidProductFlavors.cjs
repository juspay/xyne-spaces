const { createRunOncePlugin, withAppBuildGradle } = require('@expo/config-plugins');

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
        sandbox {
            dimension "env"
            signingConfig signingConfigs.debug
            manifestPlaceholders = [usesCleartextTraffic: "false"]
            versionNameSuffix "-sandbox"
            resValue "string", "app_name", "Xyne Spaces Sandbox"
        }
${COMMUNITY_FLAVOR}
    }`;
}

function withAndroidProductFlavors(config) {
  return withAppBuildGradle(config, cfg => {
    if (cfg.modResults.language !== 'groovy') {
      return cfg;
    }
    let contents = cfg.modResults.contents;
    if (contents.includes('flavorDimensions')) {
      cfg.modResults.contents = ensureReactDebuggableVariants(ensureCommunityFlavor(contents));
      return cfg;
    }
    contents = insertAfterBuildTypes(contents, flavorBlock());
    contents = ensureReactDebuggableVariants(contents);
    cfg.modResults.contents = contents;
    return cfg;
  });
}

module.exports = createRunOncePlugin(withAndroidProductFlavors, PLUGIN_NAME, PLUGIN_VERSION);
