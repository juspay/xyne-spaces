const {
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');
const {
  getPrebuildVariant,
  iosAppGroupIdentifier,
  googleServicesPlistPath,
} = require('../config/variants.cjs');

const PLUGIN_NAME = 'with-notification-service-ios';
const PLUGIN_VERSION = '1.0.0';
const EXTENSION_TARGET_NAME = 'NotificationService';
const DEVELOPMENT_TEAM = 'YM9U73Z2JM';
const IPHONEOS_DEPLOYMENT_TARGET = '16.4';
const EXTENSION_SOURCE_FILES = [
  'NotificationService.swift',
  'NotificationCacheWriter.h',
  'NotificationCacheWriter.mm',
  'NotificationService-Bridging-Header.h',
  'Info.plist',
];

const LEGACY_APP_GROUP = 'group.net.juspay.xynespaces.share';
// API base hardcoded in NotificationService.swift; swapped for the variant's backend at prebuild.
const LEGACY_API_BASE_URL = 'https://app.spaces.xyne.juspay.net/api';

function iosNotificationServiceBundleId(v) {
  return `${v.iosBundleIdentifier}.NotificationService`;
}

function resolveBundleVersions(config) {
  return {
    marketingVersion: config.version || '1.0.0',
    currentProjectVersion: config.ios?.buildNumber || '1',
  };
}

function resolveRemoteLoggingSetting(config, variantKey, buildConfigurationName) {
  const raw = String(
    config.extra?.lotusRemoteLoggingEnabled ?? process.env.LOTUS_REMOTE_LOGGING_ENABLED ?? '',
  )
    .trim()
    .toLowerCase();

  if (raw === 'true') return 'YES';
  if (raw === 'false') return 'NO';

  // Keep the extension in lockstep with parseRemoteLoggingEnabled(): only a
  // production Release extension sends remote delivery telemetry by default.
  const isProductionVariant = variantKey === 'prod' || variantKey === 'community';
  return isProductionVariant && buildConfigurationName === 'Release' ? 'YES' : 'NO';
}

function patchPodfileForNotificationService(podfileContent) {
  const notificationServiceBlockRegex = new RegExp(
    `\\ntarget '${EXTENSION_TARGET_NAME}' do\\n[\\s\\S]*?\\nend\\n?`,
    'g',
  );
  let cleaned = podfileContent.replace(notificationServiceBlockRegex, '\n');

  // Issue 1A: Firebase must be linked into the NSE process so a crash inside
  // the extension is captured by Crashlytics. FirebaseCrashlytics installs its
  // native exception/signal handlers as soon as FirebaseApp.configure() runs.
  // IMPORTANT: Must use :modular_headers => true to match main app target config,
  // otherwise CocoaPods will fail with module build conflicts.
  const extensionBlock =
    `target '${EXTENSION_TARGET_NAME}' do\n` +
    `  pod 'MMKVCore', '2.4.0'\n` +
    `  pod 'GoogleUtilities', :modular_headers => true\n` +
    `  pod 'FirebaseCore', :modular_headers => true\n` +
    `  pod 'FirebaseCoreInternal', :modular_headers => true\n` +
    `  pod 'FirebaseCrashlytics', :modular_headers => true\n` +
    `  pod 'GoogleDataTransport', :modular_headers => true\n` +
    `  pod 'nanopb', :modular_headers => true\n` +
    `end\n`;

  return `${cleaned.trimEnd()}\n\n${extensionBlock}`;
}

function patchNotificationServiceSources(dir, appGroup, apiBaseUrl) {
  for (const file of EXTENSION_SOURCE_FILES) {
    if (!file.endsWith('.swift') && !file.endsWith('.plist')) continue;

    const target = path.join(dir, file);
    const contents = readFileIfExists(target);
    if (contents === null) continue;
    const updated = contents
      .split(LEGACY_APP_GROUP)
      .join(appGroup)
      .split(LEGACY_API_BASE_URL)
      .join(apiBaseUrl);
    if (updated !== contents) {
      fs.writeFileSync(target, updated, 'utf8');
    }
  }
}

function writeNotificationServiceEntitlements(platformProjectRoot, appGroup, iosBundleIdentifier) {
  const entitlementsPath = path.join(
    platformProjectRoot,
    EXTENSION_TARGET_NAME,
    `${EXTENSION_TARGET_NAME}.entitlements`,
  );

  const entitlements = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.application-groups</key>
\t<array>
\t\t<string>${appGroup}</string>
\t</array>
\t<key>keychain-access-groups</key>
\t<array>
\t\t<string>$(AppIdentifierPrefix)${iosBundleIdentifier}</string>
\t</array>
</dict>
</plist>
`;

  fs.writeFileSync(entitlementsPath, entitlements, 'utf8');
}

function unquotePbxValue(value) {
  return String(value || '').replace(/^"|"$/g, '');
}

function ensureSourceFileOnTarget(project, fileName, targetUuid, fileType) {
  const objects = project.hash.project.objects;
  let fileRefUuid = null;

  for (const [uuid, object] of Object.entries(objects.PBXFileReference || {})) {
    if (object && unquotePbxValue(object.path) === fileName) {
      fileRefUuid = uuid;
      object.fileEncoding = 4;
      object.lastKnownFileType = fileType;
      delete object.explicitFileType;
      break;
    }
  }

  if (!fileRefUuid) return;

  let buildFileUuid = null;
  for (const [uuid, object] of Object.entries(objects.PBXBuildFile || {})) {
    if (object && object.fileRef === fileRefUuid) {
      buildFileUuid = uuid;
      object.fileRef_comment = fileName;
      objects.PBXBuildFile[`${uuid}_comment`] = `${fileName} in Sources`;
      break;
    }
  }

  if (!buildFileUuid) {
    buildFileUuid = project.generateUuid();
    objects.PBXBuildFile[buildFileUuid] = {
      isa: 'PBXBuildFile',
      fileRef: fileRefUuid,
      fileRef_comment: fileName,
    };
    objects.PBXBuildFile[`${buildFileUuid}_comment`] = `${fileName} in Sources`;
  }

  for (const phase of Object.values(objects.PBXSourcesBuildPhase || {})) {
    if (!phase || !Array.isArray(phase.files)) continue;
    phase.files = phase.files.filter(entry => entry.value !== buildFileUuid);
  }

  const target = objects.PBXNativeTarget?.[targetUuid];
  const targetBuildPhases = target?.buildPhases || [];
  const sourcePhase = targetBuildPhases.find(phase => phase.comment === 'Sources');
  const sourcePhaseId = sourcePhase?.value;

  if (!sourcePhaseId || !objects.PBXSourcesBuildPhase[sourcePhaseId]) return;

  objects.PBXSourcesBuildPhase[sourcePhaseId].files ||= [];
  objects.PBXSourcesBuildPhase[sourcePhaseId].files.push({
    value: buildFileUuid,
    comment: `${fileName} in Sources`,
  });
}

function ensureResourceFileOnTarget(
  project,
  fileName,
  groupUuid,
  targetUuid,
  lastKnownFileType = 'text.plist.xml',
) {
  const objects = project.hash.project.objects;
  objects.PBXFileReference ||= {};
  objects.PBXBuildFile ||= {};
  objects.PBXResourcesBuildPhase ||= {};

  const group = objects.PBXGroup?.[groupUuid];
  if (!group) return;

  group.children ||= [];

  let fileRefUuid = null;
  for (const child of group.children) {
    const object = objects.PBXFileReference?.[child.value];
    if (object && unquotePbxValue(object.path) === fileName) {
      fileRefUuid = child.value;
      object.fileEncoding = 4;
      object.lastKnownFileType = lastKnownFileType;
      object.name = fileName;
      object.path = fileName;
      object.sourceTree = '"<group>"';
      delete object.explicitFileType;
      break;
    }
  }

  if (!fileRefUuid) {
    fileRefUuid = project.generateUuid();
    objects.PBXFileReference[fileRefUuid] = {
      isa: 'PBXFileReference',
      fileEncoding: 4,
      lastKnownFileType,
      name: fileName,
      path: fileName,
      sourceTree: '"<group>"',
    };
    objects.PBXFileReference[`${fileRefUuid}_comment`] = fileName;
    group.children.push({ value: fileRefUuid, comment: fileName });
  }

  const target = objects.PBXNativeTarget?.[targetUuid];
  if (!target) return;

  target.buildPhases ||= [];
  let resourcePhaseRef = target.buildPhases.find(phase => phase.comment === 'Resources');
  if (!resourcePhaseRef) {
    const resourcePhaseUuid = project.generateUuid();
    objects.PBXResourcesBuildPhase[resourcePhaseUuid] = {
      isa: 'PBXResourcesBuildPhase',
      buildActionMask: 2147483647,
      files: [],
      runOnlyForDeploymentPostprocessing: 0,
    };
    objects.PBXResourcesBuildPhase[`${resourcePhaseUuid}_comment`] = 'Resources';
    resourcePhaseRef = { value: resourcePhaseUuid, comment: 'Resources' };
    target.buildPhases.push(resourcePhaseRef);
  }

  const resourcePhase = objects.PBXResourcesBuildPhase[resourcePhaseRef.value];
  if (!resourcePhase) return;

  resourcePhase.files ||= [];
  const resourcePhaseUuid = resourcePhaseRef.value;
  const isUsedByAnotherResourcePhase = buildFileUuid =>
    Object.entries(objects.PBXResourcesBuildPhase).some(
      ([uuid, phase]) =>
        uuid !== resourcePhaseUuid &&
        !uuid.endsWith('_comment') &&
        phase?.files?.some(file => file.value === buildFileUuid),
    );
  const resourceFileName = buildFileUuid => {
    const fileRef = objects.PBXBuildFile?.[buildFileUuid]?.fileRef;
    return path.basename(unquotePbxValue(objects.PBXFileReference?.[fileRef]?.path));
  };

  let buildFileUuid = resourcePhase.files.find(
    file => objects.PBXBuildFile?.[file.value]?.fileRef === fileRefUuid,
  )?.value;
  if (buildFileUuid && isUsedByAnotherResourcePhase(buildFileUuid)) {
    buildFileUuid = null;
  }

  if (!buildFileUuid) {
    buildFileUuid = project.generateUuid();
    objects.PBXBuildFile[buildFileUuid] = {
      isa: 'PBXBuildFile',
      fileRef: fileRefUuid,
      fileRef_comment: fileName,
    };
  }
  objects.PBXBuildFile[buildFileUuid].fileRef_comment = fileName;
  objects.PBXBuildFile[`${buildFileUuid}_comment`] = `${fileName} in Resources`;

  resourcePhase.files = resourcePhase.files.filter(
    file => resourceFileName(file.value) !== fileName,
  );
  resourcePhase.files.push({ value: buildFileUuid, comment: `${fileName} in Resources` });
}

function findNativeTargetUuidByName(project, targetName) {
  const nativeTargets = project.hash.project.objects.PBXNativeTarget || {};
  const result = Object.entries(nativeTargets).find(([, target]) => target?.name === targetName);
  return result?.[0] || null;
}

/** Uuid of the (single) application target, independent of its name. */
function findHostAppTargetUuid(project) {
  const targets = project.hash.project.objects.PBXNativeTarget || {};
  for (const [uuid, target] of Object.entries(targets)) {
    if (uuid.endsWith('_comment')) continue;
    if (target?.productType === '"com.apple.product-type.application"') return uuid;
  }
  return null;
}

function ensureSigningAttributes(project, targetUuid) {
  const projectObject = project.getFirstProject()?.firstProject;
  if (!projectObject || !targetUuid) return;

  projectObject.attributes ||= {};
  projectObject.attributes.TargetAttributes ||= {};
  projectObject.attributes.TargetAttributes[targetUuid] ||= {};

  const targetAttributes = projectObject.attributes.TargetAttributes[targetUuid];
  targetAttributes.DevelopmentTeam = DEVELOPMENT_TEAM;
  targetAttributes.ProvisioningStyle = 'Automatic';
  targetAttributes.SystemCapabilities ||= {};
  targetAttributes.SystemCapabilities['com.apple.ApplicationGroups.iOS'] = {
    enabled: 1,
  };
}

function addTargetDependencyIfMissing(project, hostTargetUuid, dependencyTargetUuid) {
  const objects = project.hash.project.objects;
  objects.PBXTargetDependency ||= {};
  objects.PBXContainerItemProxy ||= {};

  const nativeTargets = objects.PBXNativeTarget || {};
  const hostTarget = nativeTargets[hostTargetUuid];
  if (!hostTarget) return;

  const alreadyExists = (hostTarget.dependencies || []).some(dependency => {
    const dependencyObject = objects.PBXTargetDependency?.[dependency.value];
    return dependencyObject?.target === dependencyTargetUuid;
  });

  if (alreadyExists) return;

  const proxyUuid = project.generateUuid();
  const dependencyUuid = project.generateUuid();

  objects.PBXContainerItemProxy[proxyUuid] = {
    isa: 'PBXContainerItemProxy',
    containerPortal: project.hash.project.rootObject,
    containerPortal_comment: project.hash.project.rootObject_comment,
    proxyType: 1,
    remoteGlobalIDString: dependencyTargetUuid,
    remoteInfo: nativeTargets[dependencyTargetUuid].name,
  };
  objects.PBXContainerItemProxy[`${proxyUuid}_comment`] = 'PBXContainerItemProxy';

  objects.PBXTargetDependency[dependencyUuid] = {
    isa: 'PBXTargetDependency',
    target: dependencyTargetUuid,
    target_comment:
      nativeTargets[`${dependencyTargetUuid}_comment`] || nativeTargets[dependencyTargetUuid].name,
    targetProxy: proxyUuid,
    targetProxy_comment: 'PBXContainerItemProxy',
  };
  objects.PBXTargetDependency[`${dependencyUuid}_comment`] = 'PBXTargetDependency';

  hostTarget.dependencies ||= [];
  hostTarget.dependencies.push({ value: dependencyUuid, comment: 'PBXTargetDependency' });
}

function removeBuildPhaseByName(project, targetUuid, phaseName) {
  const objects = project.hash.project.objects;
  const target = objects.PBXNativeTarget?.[targetUuid];
  if (!target?.buildPhases) return;

  const shellPhases = objects.PBXShellScriptBuildPhase || {};
  const phaseIds = new Set(
    Object.entries(shellPhases)
      .filter(([, phase]) => phase?.name === phaseName)
      .map(([uuid]) => uuid),
  );

  target.buildPhases = target.buildPhases.filter(phase => !phaseIds.has(phase.value));
}

function removeSourceFileFromTarget(project, targetUuid, fileName) {
  const objects = project.hash.project.objects;
  const fileRefUuids = new Set(
    Object.entries(objects.PBXFileReference || {})
      .filter(([, fileRef]) => fileRef?.path && unquotePbxValue(fileRef.path).endsWith(fileName))
      .map(([uuid]) => uuid),
  );

  const buildFileUuids = new Set(
    Object.entries(objects.PBXBuildFile || {})
      .filter(([, buildFile]) => fileRefUuids.has(buildFile?.fileRef))
      .map(([uuid]) => uuid),
  );

  const target = objects.PBXNativeTarget?.[targetUuid];
  const sourcePhaseIds = (target?.buildPhases || [])
    .filter(phase => phase.comment === 'Sources')
    .map(phase => phase.value);

  for (const phaseId of sourcePhaseIds) {
    const sourcePhase = objects.PBXSourcesBuildPhase?.[phaseId];
    if (!sourcePhase?.files) continue;
    sourcePhase.files = sourcePhase.files.filter(entry => !buildFileUuids.has(entry.value));
  }
}

const withNotificationServiceFiles = config => {
  const v = getPrebuildVariant();
  const appGroup = iosAppGroupIdentifier(v);

  return withDangerousMod(config, [
    'ios',
    async config => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const sourceDir = path.join(projectRoot, 'plugins', 'notification-service');
      const targetDir = path.join(platformProjectRoot, EXTENSION_TARGET_NAME);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      for (const file of EXTENSION_SOURCE_FILES) {
        const src = path.join(sourceDir, file);
        const dst = path.join(targetDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
        }
      }

      // Issue 1A: bundle the variant GoogleService-Info.plist into the NSE so
      // FirebaseApp.configure() (called in didReceive) can resolve options from
      // the extension's own bundle. Same Firebase project as the host app, so
      // crashes land under the same app in the Crashlytics console.
      try {
        const plistSrc = googleServicesPlistPath(v);
        if (fs.existsSync(plistSrc)) {
          fs.copyFileSync(plistSrc, path.join(targetDir, 'GoogleService-Info.plist'));
        } else {
          console.warn(`[${PLUGIN_NAME}] GoogleService-Info.plist not found at ${plistSrc}`);
        }
      } catch (e) {
        console.warn(`[${PLUGIN_NAME}] Failed to copy GoogleService-Info.plist: ${e.message}`);
      }

      // Bundle SOS siren in the NSE so UNNotificationSound(named:) can resolve it
      // from the extension process (mirrors bell/string.caf in the main app target).
      const sosSoundSrc = path.join(projectRoot, 'assets', 'sounds', 'sos_alert.caf');
      const sosSoundDst = path.join(targetDir, 'sos_alert.caf');
      if (fs.existsSync(sosSoundSrc)) {
        fs.copyFileSync(sosSoundSrc, sosSoundDst);
      } else {
        console.warn(
          `[${PLUGIN_NAME}] Missing assets/sounds/sos_alert.caf — SOS NSE sound may be silent`,
        );
      }

      patchNotificationServiceSources(targetDir, appGroup, v.defaultApiBaseUrl);
      writeNotificationServiceEntitlements(platformProjectRoot, appGroup, v.iosBundleIdentifier);

      const podfilePath = path.join(platformProjectRoot, 'Podfile');
      const podfileContent = readFileIfExists(podfilePath);
      if (podfileContent !== null) {
        const updatedPodfile = patchPodfileForNotificationService(podfileContent);
        if (updatedPodfile !== podfileContent) {
          fs.writeFileSync(podfilePath, updatedPodfile, 'utf8');
        }
      }

      return config;
    },
  ]);
};

const withNotificationServiceXcode = config => {
  const v = getPrebuildVariant();
  const extensionBundleId = iosNotificationServiceBundleId(v);

  return withXcodeProject(config, config => {
    const project = config.modResults;
    const bundleVersions = resolveBundleVersions(config);
    let target = project.pbxTargetByName(EXTENSION_TARGET_NAME);
    let targetUuid;
    let groupUuid = project.findPBXGroupKey({ name: EXTENSION_TARGET_NAME });

    if (target) {
      targetUuid = target.uuid || findNativeTargetUuidByName(project, EXTENSION_TARGET_NAME);
    } else {
      target = project.addTarget(
        EXTENSION_TARGET_NAME,
        'app_extension',
        EXTENSION_TARGET_NAME,
        extensionBundleId,
      );

      targetUuid = target.uuid;
      project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);
      // Issue 1A: a Resources phase is required so GoogleService-Info.plist is
      // copied into the extension bundle for FirebaseApp.configure().
      project.addBuildPhase([], 'PBXResourcesBuildPhase', 'Resources', targetUuid);

      const groupResult = project.addPbxGroup([], EXTENSION_TARGET_NAME, EXTENSION_TARGET_NAME);
      groupUuid = groupResult.uuid;

      const mainGroup = project.getFirstProject().firstProject.mainGroup;
      if (mainGroup) {
        const groups = project.hash.project.objects['PBXGroup'];
        if (groups[mainGroup]) {
          groups[mainGroup].children = groups[mainGroup].children || [];
          groups[mainGroup].children.push({
            value: groupResult.uuid,
            comment: EXTENSION_TARGET_NAME,
          });
        }
      }
    }

    if (!groupUuid) {
      const groupResult = project.addPbxGroup([], EXTENSION_TARGET_NAME, EXTENSION_TARGET_NAME);
      groupUuid = groupResult.uuid;
    }

    ensureSigningAttributes(project, targetUuid);

    for (const file of ['NotificationService.swift', 'NotificationCacheWriter.mm']) {
      if (!project.hasFile(file)) {
        project.addSourceFile(file, { target: targetUuid }, groupUuid);
      }
    }

    ensureSourceFileOnTarget(
      project,
      'NotificationCacheWriter.mm',
      targetUuid,
      'sourcecode.cpp.objcpp',
    );
    removeSourceFileFromTarget(project, targetUuid, 'ExpoModulesProvider.swift');
    removeBuildPhaseByName(project, targetUuid, '"[Expo] Configure project"');
    removeBuildPhaseByName(project, targetUuid, '[Expo] Configure project');

    for (const file of ['NotificationCacheWriter.h', 'NotificationService-Bridging-Header.h']) {
      if (!project.hasFile(file)) {
        project.addHeaderFile(file, { target: targetUuid }, groupUuid);
      }
    }

    if (!project.hasFile(`${EXTENSION_TARGET_NAME}.entitlements`)) {
      project.addFile(`${EXTENSION_TARGET_NAME}.entitlements`, groupUuid, { target: targetUuid });
    }

    if (!project.hasFile('Info.plist')) {
      project.addFile('Info.plist', groupUuid, { target: targetUuid });
    }

    // Same basename as the host app plist, so add it through the extension group
    // and Resources phase directly instead of relying on project.hasFile().
    ensureResourceFileOnTarget(project, 'GoogleService-Info.plist', groupUuid, targetUuid);
    ensureResourceFileOnTarget(project, 'sos_alert.caf', groupUuid, targetUuid, 'audio.aiff-core');

    const userNotificationsPath = 'System/Library/Frameworks/UserNotifications.framework';
    project.addFramework(userNotificationsPath, {
      target: targetUuid,
      sourceTree: 'SDKROOT',
      link: true,
    });

    const avFoundationPath = 'System/Library/Frameworks/AVFoundation.framework';
    project.addFramework(avFoundationPath, {
      target: targetUuid,
      sourceTree: 'SDKROOT',
      link: true,
    });

    const audioToolboxPath = 'System/Library/Frameworks/AudioToolbox.framework';
    project.addFramework(audioToolboxPath, {
      target: targetUuid,
      sourceTree: 'SDKROOT',
      link: true,
    });

    // The host app target is named after the display name with whitespace removed
    // (`Xyne Spaces Community` → `XyneSpacesCommunity`), so resolve it rather than hardcoding.
    const hostTargetName =
      config.modRequest?.projectName || String(config.name || '').replace(/\s+/g, '');
    const hostTargetUuid =
      findNativeTargetUuidByName(project, hostTargetName) || findHostAppTargetUuid(project);
    if (hostTargetUuid && targetUuid) {
      addTargetDependencyIfMissing(project, hostTargetUuid, targetUuid);
    } else {
      console.warn(`[${PLUGIN_NAME}] Could not resolve host app target; NSE dependency not added`);
    }

    const xcBuildConfigs = project.hash.project.objects['XCBuildConfiguration'] || {};
    const xcConfigLists = project.hash.project.objects['XCConfigurationList'] || {};
    const nativeTarget = project.hash.project.objects.PBXNativeTarget?.[targetUuid];
    const targetConfigListUuid =
      target?.pbxNativeTarget?.buildConfigurationList || nativeTarget?.buildConfigurationList;
    const configList = xcConfigLists[targetConfigListUuid];
    const buildConfigUuids = (configList && configList.buildConfigurations) || [];

    for (const { value: configUuid } of buildConfigUuids) {
      const buildConfig = xcBuildConfigs[configUuid];
      if (!buildConfig) continue;

      const s = buildConfig.buildSettings;
      s.IPHONEOS_DEPLOYMENT_TARGET = IPHONEOS_DEPLOYMENT_TARGET;
      s.SWIFT_VERSION = '5.0';
      s.CLANG_ENABLE_OBJC_WEAK = 'YES';
      s.SKIP_INSTALL = 'YES';
      s.PRODUCT_BUNDLE_IDENTIFIER = `"${extensionBundleId}"`;
      s.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
      s.CODE_SIGN_STYLE = 'Automatic';
      s.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_TARGET_NAME}/${EXTENSION_TARGET_NAME}.entitlements"`;
      s.INFOPLIST_FILE = `"${EXTENSION_TARGET_NAME}/Info.plist"`;
      s.INFOPLIST_KEY_CFBundleDisplayName = EXTENSION_TARGET_NAME;
      s.LD_RUNPATH_SEARCH_PATHS = [
        '"$(inherited)"',
        '"@executable_path/Frameworks"',
        '"@executable_path/../../Frameworks"',
      ];
      s.SWIFT_OBJC_BRIDGING_HEADER = `"${EXTENSION_TARGET_NAME}/${EXTENSION_TARGET_NAME}-Bridging-Header.h"`;
      s.TARGETED_DEVICE_FAMILY = '"1,2"';
      s.MARKETING_VERSION = bundleVersions.marketingVersion;
      s.CURRENT_PROJECT_VERSION = bundleVersions.currentProjectVersion;
      s.LOTUS_REMOTE_LOGGING_ENABLED = resolveRemoteLoggingSetting(config, v.key, buildConfig.name);
    }

    return config;
  });
};

const withMainAppEntitlements = config => {
  const v = getPrebuildVariant();
  const appGroup = iosAppGroupIdentifier(v);

  return withEntitlementsPlist(config, config => {
    const entitlements = config.modResults;
    entitlements['com.apple.security.application-groups'] =
      entitlements['com.apple.security.application-groups'] || [];

    const groups = entitlements['com.apple.security.application-groups'];
    if (!groups.includes(appGroup)) {
      groups.push(appGroup);
    }

    return config;
  });
};

const withMainAppInfoPlist = config => {
  const v = getPrebuildVariant();
  const appGroup = iosAppGroupIdentifier(v);

  return withInfoPlist(config, config => {
    config.modResults.AppGroupIdentifier = appGroup;
    return config;
  });
};

function withNotificationServiceIOS(config) {
  config = withNotificationServiceFiles(config);
  config = withNotificationServiceXcode(config);
  config = withMainAppEntitlements(config);
  config = withMainAppInfoPlist(config);
  return config;
}

module.exports = createRunOncePlugin(withNotificationServiceIOS, PLUGIN_NAME, PLUGIN_VERSION);
