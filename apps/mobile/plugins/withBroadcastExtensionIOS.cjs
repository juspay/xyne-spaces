/**
 * withBroadcastExtensionIOS.cjs — Broadcast extension wired to APP_VARIANT / variants.js
 */

const {
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const {
  getPrebuildVariant,
  iosAppGroupIdentifier,
  iosBroadcastExtensionBundleId,
} = require('../config/variants.cjs');

const PLUGIN_NAME = 'with-broadcast-extension-ios';
const PLUGIN_VERSION = '1.0.0';

const EXTENSION_TARGET_NAME = 'BroadcastExtension';
const DEVELOPMENT_TEAM = 'YM9U73Z2JM';
const IPHONEOS_DEPLOYMENT_TARGET = '16.4';

const EXTENSION_SOURCE_FILES = [
  'Atomic.swift',
  'BroadcastExtension-Bridging-Header.h',
  'BroadcastExtension.entitlements',
  'BroadcastHandler.h',
  'BroadcastHandler.m',
  'DarwinNotificationCenter.swift',
  'Info.plist',
  'SampleHandler.swift',
  'SampleUploader.swift',
  'SocketConnection.swift',
];

/** Legacy literals in plugins/broadcast-extension/* — replaced after copy */
const LEGACY_APP_GROUP = 'group.net.juspay.xynespaces.share';
const LEGACY_EXT_BUNDLE = 'net.juspay.xynespaces.BroadcastExtension';
const LEGACY_DARWIN_STARTED = 'group.net.juspay.xynespaces.broadcast.started';
const LEGACY_DARWIN_STOPPED = 'group.net.juspay.xynespaces.broadcast.stopped';
const LEGACY_SUBSYSTEM_PREFIX = 'net.juspay.xynespaces.broadcast';
const LEGACY_STOP_BROADCAST = 'net.juspay.xynespaces.STOP_BROADCAST';

function findNativeTargetUuidByName(project, targetName) {
  const targets = project.hash.project.objects.PBXNativeTarget || {};
  for (const [uuid, target] of Object.entries(targets)) {
    if (target?.name === targetName) return uuid;
  }
  return null;
}

function getTargetBuildConfigurations(project, targetUuid) {
  const targets = project.hash.project.objects.PBXNativeTarget || {};
  const lists = project.hash.project.objects.XCConfigurationList || {};
  const configs = project.hash.project.objects.XCBuildConfiguration || {};
  const target = targets[targetUuid];
  const list = target ? lists[target.buildConfigurationList] : null;
  return (list?.buildConfigurations || []).map(({ value }) => configs[value]).filter(Boolean);
}

function resolveBundleVersions(config) {
  return {
    marketingVersion: config.version || '1.0.0',
    currentProjectVersion: config.ios?.buildNumber || '1',
  };
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

/**
 * @param {string} dir
 * @param {{ iosBundleIdentifier: string, appGroup: string, extensionBundleId: string }} ids
 */
function patchBroadcastExtensionSources(dir, ids) {
  const { iosBundleIdentifier, appGroup, extensionBundleId } = ids;
  const darwinStarted = `${iosBundleIdentifier}.broadcast.started`;
  const darwinStopped = `${iosBundleIdentifier}.broadcast.stopped`;
  const subsystemPrefix = `${iosBundleIdentifier}.broadcast`;
  const stopBroadcast = `${iosBundleIdentifier}.STOP_BROADCAST`;

  const replacements = [
    [LEGACY_APP_GROUP, appGroup],
    [LEGACY_EXT_BUNDLE, extensionBundleId],
    [LEGACY_DARWIN_STARTED, darwinStarted],
    [LEGACY_DARWIN_STOPPED, darwinStopped],
    [LEGACY_SUBSYSTEM_PREFIX, subsystemPrefix],
    [LEGACY_STOP_BROADCAST, stopBroadcast],
  ];

  const walk = (d, ext) => {
    let entries;
    try {
      entries = fs.readdirSync(d, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    for (const entry of entries) {
      const name = entry.name;
      const p = path.join(d, name);
      // statSync semantics: symlinks are followed, as before.
      const isDir = entry.isSymbolicLink() ? fs.statSync(p).isDirectory() : entry.isDirectory();
      if (isDir) walk(p, ext);
      else if (ext.some(e => name.endsWith(e))) {
        let text = fs.readFileSync(p, 'utf8');
        let next = text;
        for (const [a, b] of replacements) {
          if (a !== b) next = next.split(a).join(b);
        }
        if (next !== text) fs.writeFileSync(p, next, 'utf8');
      }
    }
  };

  walk(dir, ['.swift', '.m', '.h', '.entitlements', '.plist']);
}

function buildInfoPlistTemplate() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Xyne Spaces</string>
\t<key>CFBundleExecutable</key>
\t<string>$(EXECUTABLE_NAME)</string>
\t<key>CFBundleIdentifier</key>
\t<string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
\t<key>CFBundleName</key>
\t<string>$(PRODUCT_NAME)</string>
\t<key>CFBundleShortVersionString</key>
\t<string>$(MARKETING_VERSION)</string>
\t<key>CFBundleVersion</key>
\t<string>$(CURRENT_PROJECT_VERSION)</string>
\t<key>NSExtension</key>
\t<dict>
\t\t<key>NSExtensionAttributes</key>
\t\t<dict>
\t\t\t<key>NSExtensionActivationRule</key>
\t\t\t<dict>
\t\t\t\t<key>NSExtensionActivationSupportsReplayKitStreaming</key>
\t\t\t\t<true/>
\t\t\t</dict>
\t\t</dict>
\t\t<key>NSExtensionPointIdentifier</key>
\t\t<string>com.apple.broadcast-services-upload</string>
\t\t<key>NSExtensionPrincipalClass</key>
\t\t<string>$(PRODUCT_MODULE_NAME).SampleHandler</string>
\t\t<key>RPBroadcastProcessMode</key>
\t\t<string>RPBroadcastProcessModeSampleBuffer</string>
\t</dict>
</dict>
</plist>
`;
}

const withBroadcastExtensionFiles = config => {
  const v = getPrebuildVariant();
  const appGroup = iosAppGroupIdentifier(v);
  const extensionBundleId = iosBroadcastExtensionBundleId(v);

  return withDangerousMod(config, [
    'ios',
    async config => {
      const { projectRoot, platformProjectRoot } = config.modRequest;

      const sourceDir = path.join(projectRoot, 'plugins', 'broadcast-extension');
      const targetDir = path.join(platformProjectRoot, EXTENSION_TARGET_NAME);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
        console.log(`[${PLUGIN_NAME}] Created directory: ios/${EXTENSION_TARGET_NAME}/`);
      }

      for (const file of EXTENSION_SOURCE_FILES) {
        if (file === 'Info.plist') continue;
        const src = path.join(sourceDir, file);
        const dst = path.join(targetDir, file);

        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
          console.log(`[${PLUGIN_NAME}] Copied ${file} → ios/${EXTENSION_TARGET_NAME}/${file}`);
        } else {
          console.warn(`[${PLUGIN_NAME}] Source file not found, skipping: ${src}`);
        }
      }

      patchBroadcastExtensionSources(targetDir, {
        iosBundleIdentifier: v.iosBundleIdentifier,
        appGroup,
        extensionBundleId,
      });

      const infoPlistDst = path.join(targetDir, 'Info.plist');
      fs.writeFileSync(infoPlistDst, buildInfoPlistTemplate(), 'utf8');
      console.log(`[${PLUGIN_NAME}] Wrote Info.plist → ios/${EXTENSION_TARGET_NAME}/Info.plist`);

      return config;
    },
  ]);
};

const withBroadcastExtensionXcode = config => {
  const v = getPrebuildVariant();
  const EXTENSION_BUNDLE_ID = iosBroadcastExtensionBundleId(v);

  return withXcodeProject(config, config => {
    const project = config.modResults;
    const bundleVersions = resolveBundleVersions(config);
    let targetUuid = findNativeTargetUuidByName(project, EXTENSION_TARGET_NAME);
    let groupUuid = project.findPBXGroupKey({ name: EXTENSION_TARGET_NAME });
    let createdTarget = false;

    if (targetUuid) {
      console.log(
        `[${PLUGIN_NAME}] Target "${EXTENSION_TARGET_NAME}" already exists – updating Xcode target settings.`,
      );
    } else {
      const target = project.addTarget(
        EXTENSION_TARGET_NAME,
        'app_extension',
        EXTENSION_TARGET_NAME,
        EXTENSION_BUNDLE_ID,
      );

      targetUuid = target.uuid;
      createdTarget = true;
      console.log(
        `[${PLUGIN_NAME}] Added Xcode target "${EXTENSION_TARGET_NAME}" (uuid: ${targetUuid})`,
      );

      project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);
      console.log(
        `[${PLUGIN_NAME}] Created Sources + Frameworks build phases for extension target`,
      );

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

    ensureSigningAttributes(project, targetUuid);

    const sourceFiles = [
      'Atomic.swift',
      'DarwinNotificationCenter.swift',
      'SampleHandler.swift',
      'SampleUploader.swift',
      'SocketConnection.swift',
    ];
    const headerFiles = ['BroadcastHandler.h', 'BroadcastExtension-Bridging-Header.h'];
    const objcFiles = ['BroadcastHandler.m'];

    for (const file of sourceFiles) {
      if (!project.hasFile(file)) {
        project.addSourceFile(file, { target: targetUuid }, groupUuid);
        console.log(`[${PLUGIN_NAME}] Added source file: ${file}`);
      }
    }

    for (const file of objcFiles) {
      if (!project.hasFile(file)) {
        project.addSourceFile(file, { target: targetUuid }, groupUuid);
        console.log(`[${PLUGIN_NAME}] Added ObjC source file: ${file}`);
      }
    }

    for (const file of headerFiles) {
      if (!project.hasFile(file)) {
        project.addHeaderFile(file, { target: targetUuid }, groupUuid);
        console.log(`[${PLUGIN_NAME}] Added header file: ${file}`);
      }
    }

    const infoPlistGroupPath = `${EXTENSION_TARGET_NAME}/Info.plist`;
    if (createdTarget && !project.hasFile(infoPlistGroupPath)) {
      project.addFile('Info.plist', groupUuid, { target: targetUuid });
      console.log(`[${PLUGIN_NAME}] Added file reference: Info.plist`);
    }

    if (createdTarget) {
      const replayKitPath = 'System/Library/Frameworks/ReplayKit.framework';
      project.addFramework(replayKitPath, {
        target: targetUuid,
        sourceTree: 'SDKROOT',
        link: true,
      });
      console.log(`[${PLUGIN_NAME}] Linked ReplayKit.framework to extension target`);
    }

    for (const buildConfig of getTargetBuildConfigurations(project, targetUuid)) {
      const s = buildConfig.buildSettings;

      s.IPHONEOS_DEPLOYMENT_TARGET = IPHONEOS_DEPLOYMENT_TARGET;
      s.SWIFT_VERSION = '5.0';
      s.SWIFT_OBJC_BRIDGING_HEADER = `"${EXTENSION_TARGET_NAME}/${EXTENSION_TARGET_NAME}-Bridging-Header.h"`;
      s.CLANG_ENABLE_OBJC_WEAK = 'YES';
      s.SKIP_INSTALL = 'YES';
      s.PRODUCT_BUNDLE_IDENTIFIER = `"${EXTENSION_BUNDLE_ID}"`;
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
      s.TARGETED_DEVICE_FAMILY = '"1,2"';
      s.MARKETING_VERSION = bundleVersions.marketingVersion;
      s.CURRENT_PROJECT_VERSION = bundleVersions.currentProjectVersion;

      console.log(`[${PLUGIN_NAME}] Updated build settings for config: ${buildConfig.name}`);
    }

    return config;
  });
};

const withMainAppEntitlements = config => {
  const v = getPrebuildVariant();
  const APP_GROUP = iosAppGroupIdentifier(v);

  return withEntitlementsPlist(config, config => {
    const entitlements = config.modResults;

    if (!entitlements['com.apple.security.application-groups']) {
      entitlements['com.apple.security.application-groups'] = [];
    }

    const groups = entitlements['com.apple.security.application-groups'];
    if (!groups.includes(APP_GROUP)) {
      groups.push(APP_GROUP);
      console.log(`[${PLUGIN_NAME}] Added App Group "${APP_GROUP}" to main app entitlements`);
    }

    return config;
  });
};

const withBroadcastExtensionEntitlements = config => {
  const v = getPrebuildVariant();
  const APP_GROUP = iosAppGroupIdentifier(v);

  return withDangerousMod(config, [
    'ios',
    async config => {
      const { platformProjectRoot } = config.modRequest;
      const entFile = path.join(
        platformProjectRoot,
        EXTENSION_TARGET_NAME,
        `${EXTENSION_TARGET_NAME}.entitlements`,
      );

      const entDir = path.dirname(entFile);
      fs.mkdirSync(entDir, { recursive: true });

      const entContent = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.application-groups</key>
\t<array>
\t\t<string>${APP_GROUP}</string>
\t</array>
</dict>
</plist>
`;
      try {
        // 'wx' creates the file only if it does not already exist.
        fs.writeFileSync(entFile, entContent, { encoding: 'utf8', flag: 'wx' });
        console.log(
          `[${PLUGIN_NAME}] Created extension entitlements: ios/${EXTENSION_TARGET_NAME}/${EXTENSION_TARGET_NAME}.entitlements`,
        );
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }

      return config;
    },
  ]);
};

const withMainAppInfoPlist = config => {
  const v = getPrebuildVariant();
  const APP_GROUP = iosAppGroupIdentifier(v);
  const EXTENSION_BUNDLE_ID = iosBroadcastExtensionBundleId(v);

  return withInfoPlist(config, config => {
    config.modResults['RTCAppGroupIdentifier'] = APP_GROUP;
    config.modResults['RTCScreenSharingExtension'] = EXTENSION_BUNDLE_ID;
    console.log(`[${PLUGIN_NAME}] Set RTCAppGroupIdentifier = ${APP_GROUP} in main app Info.plist`);
    console.log(
      `[${PLUGIN_NAME}] Set RTCScreenSharingExtension = ${EXTENSION_BUNDLE_ID} in main app Info.plist`,
    );
    return config;
  });
};

function withBroadcastExtensionIOS(config) {
  config = withBroadcastExtensionFiles(config);
  config = withBroadcastExtensionEntitlements(config);
  config = withBroadcastExtensionXcode(config);
  config = withMainAppEntitlements(config);
  config = withMainAppInfoPlist(config);
  return config;
}

module.exports = createRunOncePlugin(withBroadcastExtensionIOS, PLUGIN_NAME, PLUGIN_VERSION);
