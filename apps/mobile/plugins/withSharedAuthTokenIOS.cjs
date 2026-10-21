const {
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');
const { getPrebuildVariant } = require('../config/variants.cjs');

const PLUGIN_NAME = 'with-shared-auth-token-ios';
const PLUGIN_VERSION = '1.0.0';
const EXTENSION_TARGET_NAME = 'NotificationService';

function appTargetName(config) {
  return config.name?.replace(/\s+/g, '') || config.modRequest?.projectName || 'lotus';
}

function appleTeamId(config) {
  const teamId = config.ios?.appleTeamId;
  if (typeof teamId !== 'string' || !teamId.trim()) {
    throw new Error(`[${PLUGIN_NAME}] ios.appleTeamId is required for shared auth signing`);
  }
  return teamId.trim();
}

function findNativeTargetUuidByName(project, targetName) {
  const nativeTargets = project.hash.project.objects.PBXNativeTarget || {};
  const result = Object.entries(nativeTargets).find(
    ([, target]) => String(target?.name || '').replace(/^"|"$/g, '') === targetName,
  );
  return result?.[0] || null;
}

function targetHasSourceFile(project, targetUuid, filePath) {
  const objects = project.hash.project.objects;
  const fileReference = Object.entries(objects.PBXFileReference || {}).find(
    ([, file]) => String(file?.path || '').replace(/^"|"$/g, '') === filePath,
  )?.[0];
  if (!fileReference) return false;

  const target = objects.PBXNativeTarget?.[targetUuid];
  const sourcePhaseId = target?.buildPhases?.find(phase => phase?.comment === 'Sources')?.value;
  const sourcePhase = sourcePhaseId ? objects.PBXSourcesBuildPhase?.[sourcePhaseId] : null;
  const buildFiles = objects.PBXBuildFile || {};
  return Boolean(
    sourcePhase?.files?.some(file => {
      const buildFile = buildFiles[file?.value];
      return (buildFile?.fileRef || file?.fileRef) === fileReference;
    }),
  );
}

function ensureSigningAttributes(project, targetUuid, teamId) {
  const projectObject = project.getFirstProject()?.firstProject;
  if (!projectObject || !targetUuid) return;

  projectObject.attributes ||= {};
  projectObject.attributes.TargetAttributes ||= {};
  projectObject.attributes.TargetAttributes[targetUuid] ||= {};

  const targetAttributes = projectObject.attributes.TargetAttributes[targetUuid];
  targetAttributes.DevelopmentTeam = teamId;
  targetAttributes.ProvisioningStyle = 'Automatic';
  targetAttributes.SystemCapabilities ||= {};
  targetAttributes.SystemCapabilities['com.apple.ApplicationGroups.iOS'] = {
    enabled: 1,
  };
  targetAttributes.SystemCapabilities['com.apple.KeychainSharing'] = {
    enabled: 1,
  };
}

function appKeychainGroup(config) {
  const variant = getPrebuildVariant();
  return `${appleTeamId(config)}.${variant.iosBundleIdentifier}`;
}

function renderSource(source, keychainGroup) {
  return source.replace(/__KEYCHAIN_ACCESS_GROUP__/g, keychainGroup);
}

function copySource(
  projectRoot,
  destination,
  sourceFileName,
  keychainGroup,
  destinationFileName = sourceFileName,
) {
  const sourcePath = path.join(projectRoot, 'plugins', 'ios-modules', sourceFileName);
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`[${PLUGIN_NAME}] Missing source file: ${sourcePath}`);
  }
  fs.writeFileSync(
    path.join(destination, destinationFileName),
    renderSource(fs.readFileSync(sourcePath, 'utf8'), keychainGroup),
    'utf8',
  );
}

function ensureExtensionKeychainEntitlement(entitlementsPath) {
  const contents = readFileIfExists(entitlementsPath);
  if (contents === null) return;
  const entitlement = `$(AppIdentifierPrefix)${getPrebuildVariant().iosBundleIdentifier}`;
  const group = `\t<key>keychain-access-groups</key>\n\t<array>\n\t\t<string>${entitlement}</string>\n\t</array>\n`;
  const keychainGroups = /\t?<key>keychain-access-groups<\/key>\s*<array>[\s\S]*?<\/array>/;
  const updated = keychainGroups.test(contents)
    ? contents.replace(keychainGroups, group.trimEnd())
    : contents.replace(/\n<\/dict>/, `\n${group}</dict>`);
  if (updated !== contents) fs.writeFileSync(entitlementsPath, updated, 'utf8');
}

const withSharedAuthTokenFiles = config =>
  withDangerousMod(config, [
    'ios',
    async cfg => {
      const { projectRoot, platformProjectRoot } = cfg.modRequest;
      const keychainGroup = appKeychainGroup(cfg);
      const mainDir = path.join(platformProjectRoot, appTargetName(cfg));
      const extensionDir = path.join(platformProjectRoot, EXTENSION_TARGET_NAME);

      fs.mkdirSync(mainDir, { recursive: true });
      fs.mkdirSync(extensionDir, { recursive: true });
      copySource(projectRoot, mainDir, 'SharedAuthTokenKeychain.swift', keychainGroup);
      copySource(projectRoot, mainDir, 'SharedAuthTokenModule.swift', keychainGroup);
      copySource(projectRoot, mainDir, 'SharedAuthTokenModule.m', keychainGroup);
      // Use a target-specific filename: xcodeproj's hasFile() de-duplicates by
      // basename, which would otherwise leave the extension copy out of its
      // Sources phase when the host app already contains the helper.
      copySource(
        projectRoot,
        extensionDir,
        'SharedAuthTokenKeychain.swift',
        keychainGroup,
        'SharedAuthTokenKeychainExtension.swift',
      );
      ensureExtensionKeychainEntitlement(
        path.join(extensionDir, `${EXTENSION_TARGET_NAME}.entitlements`),
      );
      return cfg;
    },
  ]);

const withSharedAuthTokenXcode = config =>
  withXcodeProject(config, cfg => {
    const project = cfg.modResults;
    const appName = appTargetName(cfg);
    const appTarget = project.getFirstTarget();
    const appGroup =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject()?.firstProject?.mainGroup;
    if (!appTarget?.uuid || !appGroup) {
      throw new Error(`[${PLUGIN_NAME}] Could not resolve the main iOS target`);
    }

    const addSource = (filePath, targetUuid, groupUuid) => {
      if (!targetHasSourceFile(project, targetUuid, filePath)) {
        project.addSourceFile(filePath, { target: targetUuid }, groupUuid);
      }
    };

    addSource(`${appName}/SharedAuthTokenKeychain.swift`, appTarget.uuid, appGroup);
    addSource(`${appName}/SharedAuthTokenModule.swift`, appTarget.uuid, appGroup);
    addSource(`${appName}/SharedAuthTokenModule.m`, appTarget.uuid, appGroup);

    const extensionTarget = project.pbxTargetByName(EXTENSION_TARGET_NAME);
    const extensionTargetUuid =
      extensionTarget?.uuid || findNativeTargetUuidByName(project, EXTENSION_TARGET_NAME);
    const extensionGroup = project.findPBXGroupKey({ name: EXTENSION_TARGET_NAME });
    if (extensionTargetUuid && extensionGroup) {
      ensureSigningAttributes(project, extensionTargetUuid, appleTeamId(cfg));
      addSource('SharedAuthTokenKeychainExtension.swift', extensionTargetUuid, extensionGroup);
    }
    return cfg;
  });

const withMainAppKeychainEntitlement = config =>
  withEntitlementsPlist(config, cfg => {
    const groups = cfg.modResults['keychain-access-groups'] || [];
    const entitlement = `$(AppIdentifierPrefix)${getPrebuildVariant().iosBundleIdentifier}`;
    if (!groups.includes(entitlement)) groups.push(entitlement);
    cfg.modResults['keychain-access-groups'] = groups;
    return cfg;
  });

function withSharedAuthTokenIOS(config) {
  config = withSharedAuthTokenFiles(config);
  config = withSharedAuthTokenXcode(config);
  config = withMainAppKeychainEntitlement(config);
  return config;
}

module.exports = createRunOncePlugin(withSharedAuthTokenIOS, PLUGIN_NAME, PLUGIN_VERSION);
