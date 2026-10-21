/**
 * withRecordingWidgetIOS.cjs — Recording home-screen widget (WidgetKit extension),
 * wired to APP_VARIANT / variants.cjs. Modeled directly on withBroadcastExtensionIOS.cjs
 * (extension target) and withShareTargetIOS.cjs (main-app native module registration).
 *
 * Phase 2 baseline: deep-link-only interactivity (Link/widgetURL), works uniformly
 * from iOS 16.4 through the newest release. iOS 17+ AppIntent buttons (no-foreground
 * Stop) land in a later phase as an additive change to RecordingWidgetView.swift —
 * deployment target stays 16.4, only the AppIntent Swift code will be `@available`-gated.
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
  iosRecordingWidgetBundleId,
} = require('../config/variants.cjs');

const PLUGIN_NAME = 'with-recording-widget-ios';
const PLUGIN_VERSION = '1.0.0';

const EXTENSION_TARGET_NAME = 'RecordingWidget';
const DEVELOPMENT_TEAM = 'YM9U73Z2JM';
const IPHONEOS_DEPLOYMENT_TARGET = '16.4';

const EXTENSION_SOURCE_FILES = [
  'RecordingWidgetBundle.swift',
  'RecordingWidget.swift',
  'RecordingWidgetEntry.swift',
  'RecordingTimelineProvider.swift',
  'RecordingWidgetView.swift',
  'RecordingActivityAttributes.swift',
  'RecordingLiveActivityWidget.swift',
  'RecordingWidgetDarwinNotificationCenter.swift',
  'StopRecordingIntent.swift',
];

const MAIN_APP_MODULE_FILES = [
  'RecordingWidgetModule.swift',
  'RecordingWidgetModule.m',
  'RecordingActivityAttributes.swift',
  'LiveActivityModule.swift',
  'LiveActivityModule.m',
];

// Compiled into BOTH targets, sourced from plugins/recording-widget-ios with
// the same placeholder substitution as the extension copies.
// StopRecordingIntent conforms to LiveActivityIntent, which the system only
// runs in the app's process when the intent type exists there — the routing
// that makes its WidgetCenter reloads user-initiated instead of
// budget-deferred background refreshes (a Live Activity Stop with the app
// backgrounded would otherwise leave the home-screen widget's timer running).
const SHARED_INTENT_FILES = [
  'StopRecordingIntent.swift',
  'RecordingWidgetDarwinNotificationCenter.swift',
];

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

function resolveAppName(config) {
  return config.name?.replace(/\s+/g, '') || config.modRequest?.projectName || 'XyneSpaces';
}

function fileTypeForSource(file) {
  if (file.endsWith('.swift')) return 'sourcecode.swift';
  if (file.endsWith('.m')) return 'sourcecode.c.objc';
  if (file.endsWith('.h')) return 'sourcecode.c.h';
  return undefined;
}

function buildInfoPlistTemplate() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>CFBundleDisplayName</key>
\t<string>Recording</string>
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
\t\t<key>NSExtensionPointIdentifier</key>
\t\t<string>com.apple.widgetkit-extension</string>
\t</dict>
</dict>
</plist>
`;
}

function buildEntitlementsTemplate(appGroup) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>com.apple.security.application-groups</key>
\t<array>
\t\t<string>${appGroup}</string>
\t</array>
</dict>
</plist>
`;
}

// ─── Step 1: extension source files ────────────────────────────────────────

const withRecordingWidgetFiles = config => {
  const v = getPrebuildVariant();
  const appGroup = iosAppGroupIdentifier(v);

  return withDangerousMod(config, [
    'ios',
    async config => {
      const { projectRoot, platformProjectRoot } = config.modRequest;

      const sourceDir = path.join(projectRoot, 'plugins', 'recording-widget-ios');
      const targetDir = path.join(platformProjectRoot, EXTENSION_TARGET_NAME);
      fs.mkdirSync(targetDir, { recursive: true });

      for (const file of EXTENSION_SOURCE_FILES) {
        const src = path.join(sourceDir, file);
        if (!fs.existsSync(src)) {
          console.warn(`[${PLUGIN_NAME}] Source file not found, skipping: ${src}`);
          continue;
        }
        let contents = fs.readFileSync(src, 'utf8');
        contents = contents.replace(/__APP_GROUP__/g, appGroup);
        contents = contents.replace(/__BUNDLE_ID__/g, v.iosBundleIdentifier);
        fs.writeFileSync(path.join(targetDir, file), contents, 'utf8');
      }

      fs.writeFileSync(path.join(targetDir, 'Info.plist'), buildInfoPlistTemplate(), 'utf8');
      fs.writeFileSync(
        path.join(targetDir, `${EXTENSION_TARGET_NAME}.entitlements`),
        buildEntitlementsTemplate(appGroup),
        'utf8',
      );

      // Main-app native module (App Group publish + WidgetCenter reload).
      const appName = resolveAppName(config);
      const appDir = path.join(platformProjectRoot, appName);
      for (const file of MAIN_APP_MODULE_FILES) {
        const src = path.join(projectRoot, 'plugins', 'ios-modules', file);
        const dst = path.join(appDir, file);
        if (fs.existsSync(src)) {
          fs.copyFileSync(src, dst);
        } else {
          console.warn(`[${PLUGIN_NAME}] Source file not found, skipping: ${src}`);
        }
      }

      // Dual-target intent files — see SHARED_INTENT_FILES.
      for (const file of SHARED_INTENT_FILES) {
        const src = path.join(sourceDir, file);
        if (!fs.existsSync(src)) {
          console.warn(`[${PLUGIN_NAME}] Source file not found, skipping: ${src}`);
          continue;
        }
        let contents = fs.readFileSync(src, 'utf8');
        contents = contents.replace(/__APP_GROUP__/g, appGroup);
        contents = contents.replace(/__BUNDLE_ID__/g, v.iosBundleIdentifier);
        fs.writeFileSync(path.join(appDir, file), contents, 'utf8');
      }

      return config;
    },
  ]);
};

// ─── Step 2: Xcode project (extension target + main-app module files) ─────

const withRecordingWidgetXcode = config => {
  const v = getPrebuildVariant();
  const EXTENSION_BUNDLE_ID = iosRecordingWidgetBundleId(v);

  return withXcodeProject(config, config => {
    const project = config.modResults;
    const bundleVersions = resolveBundleVersions(config);
    let targetUuid = findNativeTargetUuidByName(project, EXTENSION_TARGET_NAME);
    let groupUuid = project.findPBXGroupKey({ name: EXTENSION_TARGET_NAME });
    let createdTarget = false;

    if (!targetUuid) {
      const target = project.addTarget(
        EXTENSION_TARGET_NAME,
        'app_extension',
        EXTENSION_TARGET_NAME,
        EXTENSION_BUNDLE_ID,
      );
      targetUuid = target.uuid;
      createdTarget = true;

      project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);

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

    for (const file of EXTENSION_SOURCE_FILES) {
      if (!project.hasFile(file)) {
        project.addSourceFile(file, { target: targetUuid }, groupUuid);
      }
    }

    const infoPlistGroupPath = `${EXTENSION_TARGET_NAME}/Info.plist`;
    if (createdTarget && !project.hasFile(infoPlistGroupPath)) {
      project.addFile('Info.plist', groupUuid, { target: targetUuid });
    }

    if (createdTarget) {
      project.addFramework('System/Library/Frameworks/WidgetKit.framework', {
        target: targetUuid,
        sourceTree: 'SDKROOT',
        link: true,
      });
      project.addFramework('System/Library/Frameworks/SwiftUI.framework', {
        target: targetUuid,
        sourceTree: 'SDKROOT',
        link: true,
      });
      project.addFramework('System/Library/Frameworks/ActivityKit.framework', {
        target: targetUuid,
        sourceTree: 'SDKROOT',
        link: true,
      });
      project.addFramework('System/Library/Frameworks/AppIntents.framework', {
        target: targetUuid,
        sourceTree: 'SDKROOT',
        link: true,
      });
    }

    for (const buildConfig of getTargetBuildConfigurations(project, targetUuid)) {
      const s = buildConfig.buildSettings;

      s.IPHONEOS_DEPLOYMENT_TARGET = IPHONEOS_DEPLOYMENT_TARGET;
      s.SWIFT_VERSION = '5.0';
      s.SKIP_INSTALL = 'YES';
      s.PRODUCT_BUNDLE_IDENTIFIER = `"${EXTENSION_BUNDLE_ID}"`;
      s.DEVELOPMENT_TEAM = DEVELOPMENT_TEAM;
      s.CODE_SIGN_STYLE = 'Automatic';
      s.CODE_SIGN_ENTITLEMENTS = `"${EXTENSION_TARGET_NAME}/${EXTENSION_TARGET_NAME}.entitlements"`;
      s.INFOPLIST_FILE = `"${EXTENSION_TARGET_NAME}/Info.plist"`;
      s.INFOPLIST_KEY_CFBundleDisplayName = 'Recording';
      s.LD_RUNPATH_SEARCH_PATHS = [
        '"$(inherited)"',
        '"@executable_path/Frameworks"',
        '"@executable_path/../../Frameworks"',
      ];
      s.TARGETED_DEVICE_FAMILY = '"1,2"';
      s.MARKETING_VERSION = bundleVersions.marketingVersion;
      s.CURRENT_PROJECT_VERSION = bundleVersions.currentProjectVersion;
    }

    // Main-app native module files (RecordingWidgetModule.swift/.m).
    const appName = resolveAppName(config);
    const appTarget = project.getFirstTarget().uuid;
    const appGroup =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject()?.firstProject?.mainGroup;

    if (!appGroup) {
      throw new Error(`[${PLUGIN_NAME}] Could not resolve PBX group for main app sources.`);
    }

    for (const file of [...MAIN_APP_MODULE_FILES, ...SHARED_INTENT_FILES]) {
      const filePath = path.join(appName, file);
      if (!project.hasFile(filePath)) {
        project.addSourceFile(
          filePath,
          { target: appTarget, lastKnownFileType: fileTypeForSource(file) },
          appGroup,
        );
      }
    }

    // ActivityKit isn't pulled in by autolinking — link it explicitly on the
    // main app target too (LiveActivityModule.swift). addFramework no-ops if
    // already present, so this is safe to run on every prebuild.
    if (!project.hasFile('ActivityKit.framework')) {
      project.addFramework('System/Library/Frameworks/ActivityKit.framework', {
        target: appTarget,
        sourceTree: 'SDKROOT',
        link: true,
      });
    }

    return config;
  });
};

// ─── Step 3: App Group on the main app's entitlements (idempotent — the same
// group is already added by withBroadcastExtensionIOS, this is defensive in
// case that plugin is ever removed) ─────────────────────────────────────────

const withMainAppEntitlements = config => {
  const v = getPrebuildVariant();
  const APP_GROUP = iosAppGroupIdentifier(v);

  return withEntitlementsPlist(config, config => {
    const entitlements = config.modResults;
    entitlements['com.apple.security.application-groups'] ||= [];
    const groups = entitlements['com.apple.security.application-groups'];
    if (!groups.includes(APP_GROUP)) {
      groups.push(APP_GROUP);
    }
    return config;
  });
};

const withMainAppInfoPlist = config =>
  withInfoPlist(config, config => {
    config.modResults['NSSupportsLiveActivities'] = true;
    return config;
  });

function withRecordingWidgetIOS(config) {
  config = withRecordingWidgetFiles(config);
  config = withRecordingWidgetXcode(config);
  config = withMainAppEntitlements(config);
  config = withMainAppInfoPlist(config);
  return config;
}

module.exports = createRunOncePlugin(withRecordingWidgetIOS, PLUGIN_NAME, PLUGIN_VERSION);
