const { createRunOncePlugin, withDangerousMod, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

const PLUGIN_NAME = 'with-ios-google-service-copy';
const PLUGIN_VERSION = '1.0.0';

const SCRIPT_NAME = 'copy-google-service-info.sh';

/**
 * Xcode's script phases (JS bundling, Expo's app config) re-evaluate app.config.js without the
 * shell's APP_VARIANT, so an Xcode build/archive would bake the default (prod) JS config into a
 * community build. Pin the prebuilt variant in ios/.xcode.env, which those phases source.
 * @param {string} platformProjectRoot
 */
function pinAppVariantInXcodeEnv(platformProjectRoot) {
  const { getPrebuildVariant } = require('../config/variants.cjs');
  const envFile = path.join(platformProjectRoot, '.xcode.env');
  const line = `export APP_VARIANT=${getPrebuildVariant().key}`;
  const existing = readFileIfExists(envFile) ?? '';
  const withoutOld = existing.replace(/^export APP_VARIANT=.*\n?/m, '');
  fs.writeFileSync(envFile, `${withoutOld.replace(/\n*$/, '\n')}${line}\n`, 'utf8');
}

/**
 * Canonical script in repo: lotus/scripts/ios/ (preferred) or lotus/ios/scripts/.
 * @param {string} projectRoot
 * @returns {string | null}
 */
function resolveScriptSource(projectRoot) {
  const candidates = [
    path.join(projectRoot, 'scripts', 'ios', SCRIPT_NAME),
    path.join(projectRoot, 'ios', 'scripts', SCRIPT_NAME),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function withIosGoogleServiceCopy(config) {
  config = withDangerousMod(config, [
    'ios',
    async cfg => {
      const { projectRoot, platformProjectRoot } = cfg.modRequest;
      pinAppVariantInXcodeEnv(platformProjectRoot);
      const src = resolveScriptSource(projectRoot);
      const dstDir = path.join(platformProjectRoot, 'scripts');
      const dst = path.join(dstDir, SCRIPT_NAME);

      if (!src) {
        console.warn(
          `[${PLUGIN_NAME}] Missing ${SCRIPT_NAME} — add lotus/scripts/ios/${SCRIPT_NAME} (or ios/scripts/).`,
        );
        return cfg;
      }

      if (!fs.existsSync(dstDir)) {
        fs.mkdirSync(dstDir, { recursive: true });
      }
      fs.copyFileSync(src, dst);
      fs.chmodSync(dst, 0o755);
      return cfg;
    },
  ]);

  return withXcodeProject(config, cfg => {
    const project = cfg.modResults;
    const targetUuid = project.getFirstTarget().uuid;
    const phaseName = 'Copy GoogleService-Info.plist';

    const objects = project.hash.project.objects['PBXShellScriptBuildPhase'] || {};
    const already = Object.values(objects).some(
      o =>
        o &&
        typeof o.shellScript === 'string' &&
        o.shellScript.includes(SCRIPT_NAME),
    );
    if (already) {
      return cfg;
    }

    const relScript = `scripts/${SCRIPT_NAME}`;
    const shellScript =
      'if [ -z "${SRCROOT:-}" ]; then export SRCROOT="${PROJECT_DIR}"; fi\n' +
      '"${SRCROOT}/' +
      relScript +
      '"\n';

    project.addBuildPhase([], 'PBXShellScriptBuildPhase', phaseName, targetUuid, {
      shellPath: '/bin/sh',
      shellScript,
      runOnlyForDeploymentPostprocessing: 0,
    });

    return cfg;
  });
}

module.exports = createRunOncePlugin(withIosGoogleServiceCopy, PLUGIN_NAME, PLUGIN_VERSION);