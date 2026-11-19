const {
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { getPrebuildVariant } = require('../../config/variants.cjs');

/**
 * Adds the transit key module (plugins/ios-modules/TransitKeyModule.*): the per-device ECDH key
 * in the Secure Enclave that the encryption transit layer uses. Its Keychain items live in an
 * access group of their own, given to the main app only, so the extensions that share the auth
 * token's group cannot reach them.
 */
const PLUGIN_NAME = 'with-transit-key-module-ios';

const TRANSIT_KEY_FILES = ['TransitKeyModule.swift', 'TransitKeyModule.m'];

function appName(config) {
  return config.name?.replace(/\s+/g, '') || 'lotus';
}

function appleTeamId(config) {
  const teamId = config.ios?.appleTeamId;
  if (typeof teamId !== 'string' || !teamId.trim()) {
    throw new Error(`[${PLUGIN_NAME}] ios.appleTeamId is required for the transit key group`);
  }
  return teamId.trim();
}

function transitKeyGroupSuffix() {
  return `${getPrebuildVariant().iosBundleIdentifier}.transit-key`;
}

const withTransitKeyFiles = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const sourceDir = path.join(projectRoot, 'plugins', 'ios-modules');
      const targetDir = path.join(platformProjectRoot, appName(config));
      const accessGroup = `${appleTeamId(config)}.${transitKeyGroupSuffix()}`;

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const fileName of TRANSIT_KEY_FILES) {
        const sourcePath = path.join(sourceDir, fileName);
        if (!fs.existsSync(sourcePath)) {
          throw new Error(`[${PLUGIN_NAME}] Missing source file: ${sourcePath}`);
        }
        const source = fs
          .readFileSync(sourcePath, 'utf8')
          .replace(/__TRANSIT_KEY_ACCESS_GROUP__/g, accessGroup);
        fs.writeFileSync(path.join(targetDir, fileName), source, 'utf8');
        console.log(`[${PLUGIN_NAME}] Copied ${fileName}`);
      }

      return config;
    },
  ]);
};

const withTransitKeyXcode = config => {
  return withXcodeProject(config, config => {
    const { modResults: project } = config;
    const name = appName(config);
    const targetUuid = project.getFirstTarget().uuid;
    const group =
      project.findPBXGroupKey({ name }) || project.getFirstProject()?.firstProject?.mainGroup;
    if (!group) {
      throw new Error(`[${PLUGIN_NAME}] Could not resolve the PBX group for native sources.`);
    }

    for (const fileName of TRANSIT_KEY_FILES) {
      const filePath = path.join(name, fileName);
      if (project.hasFile(filePath)) continue;
      project.addSourceFile(
        filePath,
        {
          target: targetUuid,
          lastKnownFileType: fileName.endsWith('.swift') ? 'sourcecode.swift' : undefined,
        },
        group,
      );
      console.log(`[${PLUGIN_NAME}] Added ${fileName} to Xcode project`);
    }

    return config;
  });
};

/**
 * The main app's own Keychain group for the transit key; no extension gets it. iOS puts items
 * saved without a group (SecureStore's, the mTLS key) in the first listed group, so the app's
 * default group stays first whatever order the plugins run in, and this one goes after it.
 */
const withTransitKeyEntitlement = config =>
  withEntitlementsPlist(config, cfg => {
    const groups = cfg.modResults['keychain-access-groups'] || [];
    const defaultGroup = `$(AppIdentifierPrefix)${getPrebuildVariant().iosBundleIdentifier}`;
    const transitKeyGroup = `$(AppIdentifierPrefix)${transitKeyGroupSuffix()}`;
    if (!groups.includes(defaultGroup)) groups.unshift(defaultGroup);
    if (!groups.includes(transitKeyGroup)) groups.push(transitKeyGroup);
    cfg.modResults['keychain-access-groups'] = groups;
    return cfg;
  });

module.exports = config => {
  config = withTransitKeyFiles(config);
  config = withTransitKeyXcode(config);
  config = withTransitKeyEntitlement(config);
  return config;
};
