const {
  createRunOncePlugin,
  withDangerousMod,
  withEntitlementsPlist,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');
const { getPrebuildVariant, iosAppGroupIdentifier } = require('../config/variants.cjs');

const NAME = 'with-share-target-ios';
const VERSION = '1.0.0';
const EXT = 'ShareExtension';
const TEAM = 'YM9U73Z2JM';
const DEPLOYMENT_TARGET = '16.4';

function shareExtBundleId(v) {
  return `${v.iosBundleIdentifier}.ShareExtension`;
}

function resolveAppName(config) {
  return config.name?.replace(/\s+/g, '') || config.modRequest?.projectName || 'lotus';
}

function fileTypeForSource(file) {
  if (file.endsWith('.swift')) return 'sourcecode.swift';
  if (file.endsWith('.m')) return 'sourcecode.c.objc';
  if (file.endsWith('.h')) return 'sourcecode.c.h';
  return undefined;
}

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

function ensureAppGroupCapability(project, targetUuid) {
  const projectObject = project.getFirstProject()?.firstProject;
  projectObject.attributes ||= {};
  projectObject.attributes.TargetAttributes ||= {};
  projectObject.attributes.TargetAttributes[targetUuid] ||= {};

  const targetAttributes = projectObject.attributes.TargetAttributes[targetUuid];
  targetAttributes.DevelopmentTeam = TEAM;
  targetAttributes.ProvisioningStyle = 'Automatic';
  targetAttributes.SystemCapabilities ||= {};
  targetAttributes.SystemCapabilities['com.apple.ApplicationGroups.iOS'] = {
    enabled: 1,
  };
}

function writeInfoPlist(file) {
  fs.writeFileSync(
    file,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDisplayName</key>
  <string>Xyne Spaces</string>
  <key>CFBundleExecutable</key>
  <string>$(EXECUTABLE_NAME)</string>
  <key>CFBundleIdentifier</key>
  <string>$(PRODUCT_BUNDLE_IDENTIFIER)</string>
  <key>CFBundleName</key>
  <string>$(PRODUCT_NAME)</string>
  <key>CFBundleShortVersionString</key>
  <string>$(MARKETING_VERSION)</string>
  <key>CFBundleVersion</key>
  <string>$(CURRENT_PROJECT_VERSION)</string>
  <key>NSExtension</key>
  <dict>
    <key>NSExtensionAttributes</key>
    <dict>
      <key>NSExtensionActivationRule</key>
      <dict>
        <key>NSExtensionActivationSupportsText</key><true/>
        <key>NSExtensionActivationSupportsWebURLWithMaxCount</key><integer>1</integer>
        <key>NSExtensionActivationSupportsImageWithMaxCount</key><integer>10</integer>
        <key>NSExtensionActivationSupportsMovieWithMaxCount</key><integer>10</integer>
        <key>NSExtensionActivationSupportsFileWithMaxCount</key><integer>10</integer>
      </dict>
    </dict>
    <key>NSExtensionPointIdentifier</key>
    <string>com.apple.share-services</string>
    <key>NSExtensionPrincipalClass</key>
    <string>$(PRODUCT_MODULE_NAME).ShareViewController</string>
  </dict>
</dict>
</plist>
`,
    'utf8',
  );
}

const withShareFiles = config => {
  const v = getPrebuildVariant();
  const appGroup = iosAppGroupIdentifier(v);
  return withDangerousMod(config, [
    'ios',
    async cfg => {
      const { projectRoot, platformProjectRoot } = cfg.modRequest;

      const extDir = path.join(platformProjectRoot, EXT);
      fs.mkdirSync(extDir, { recursive: true });
      let swift = fs.readFileSync(
        path.join(projectRoot, 'plugins', 'share-extension', 'ShareViewController.swift'),
        'utf8',
      );
      swift = swift.replace(/__APP_GROUP__/g, appGroup).replace(/__URL_SCHEME__/g, 'xyne-spaces');
      fs.writeFileSync(path.join(extDir, 'ShareViewController.swift'), swift, 'utf8');
      writeInfoPlist(path.join(extDir, 'Info.plist'));
      fs.writeFileSync(
        path.join(extDir, `${EXT}.entitlements`),
        `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>com.apple.security.application-groups</key>
<array><string>${appGroup}</string></array>
</dict></plist>
`,
        'utf8',
      );

      for (const file of ['ShareTargetModule.swift', 'ShareTargetModule.m']) {
        const src = path.join(projectRoot, 'plugins', 'ios-modules', file);
        const dst = path.join(platformProjectRoot, resolveAppName(cfg), file);
        if (fs.existsSync(src)) fs.copyFileSync(src, dst);
      }

      return cfg;
    },
  ]);
};

const withMainAppGroup = config =>
  withEntitlementsPlist(config, cfg => {
    const v = getPrebuildVariant();
    const group = iosAppGroupIdentifier(v);
    const key = 'com.apple.security.application-groups';
    cfg.modResults[key] ||= [];
    if (!cfg.modResults[key].includes(group)) cfg.modResults[key].push(group);
    return cfg;
  });

const withAppGroupInfo = config =>
  withInfoPlist(config, cfg => {
    const v = getPrebuildVariant();
    cfg.modResults.AppGroupIdentifier = iosAppGroupIdentifier(v);
    return cfg;
  });

const withShareXcode = config => {
  const v = getPrebuildVariant();
  return withXcodeProject(config, cfg => {
    const project = cfg.modResults;
    let targetUuid = findNativeTargetUuidByName(project, EXT);

    if (!targetUuid) {
      const target = project.addTarget(EXT, 'app_extension', EXT, shareExtBundleId(v));
      targetUuid = target.uuid;

      const group = project.addPbxGroup([], EXT, EXT);
      const mainGroup = project.getFirstProject().firstProject.mainGroup;
      project.hash.project.objects.PBXGroup[mainGroup].children.push({
        value: group.uuid,
        comment: EXT,
      });

      project.addBuildPhase([], 'PBXSourcesBuildPhase', 'Sources', targetUuid);
      project.addBuildPhase([], 'PBXFrameworksBuildPhase', 'Frameworks', targetUuid);
      project.addSourceFile('ShareViewController.swift', { target: targetUuid }, group.uuid);
      project.addFile('Info.plist', group.uuid, { target: targetUuid });
    }

    ensureAppGroupCapability(project, targetUuid);
    const bundleVersions = resolveBundleVersions(cfg);

    for (const config of getTargetBuildConfigurations(project, targetUuid)) {
      const s = config.buildSettings;
      s.CODE_SIGN_STYLE = 'Automatic';
      s.DEVELOPMENT_TEAM = TEAM;
      s.IPHONEOS_DEPLOYMENT_TARGET = DEPLOYMENT_TARGET;
      s.SWIFT_VERSION = '5.0';
      s.SKIP_INSTALL = 'YES';
      s.TARGETED_DEVICE_FAMILY = '"1,2"';
      s.MARKETING_VERSION = bundleVersions.marketingVersion;
      s.CURRENT_PROJECT_VERSION = bundleVersions.currentProjectVersion;
      s.PRODUCT_BUNDLE_IDENTIFIER = `"${shareExtBundleId(v)}"`;
      s.INFOPLIST_FILE = `"${EXT}/Info.plist"`;
      s.CODE_SIGN_ENTITLEMENTS = `"${EXT}/${EXT}.entitlements"`;
      delete s.PROVISIONING_PROFILE;
      delete s.PROVISIONING_PROFILE_SPECIFIER;
      delete s['PROVISIONING_PROFILE_SPECIFIER[sdk=iphoneos*]'];
    }

    // Add main app Swift module files.
    const appName = resolveAppName(cfg);
    const appTarget = project.getFirstTarget().uuid;
    const appGroup =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject()?.firstProject?.mainGroup;

    if (!appGroup) {
      throw new Error(`[${NAME}] Could not resolve PBX group for native app sources.`);
    }

    for (const f of ['ShareTargetModule.swift', 'ShareTargetModule.m']) {
      const filePath = path.join(appName, f);
      if (!project.hasFile(filePath)) {
        project.addSourceFile(
          filePath,
          { target: appTarget, lastKnownFileType: fileTypeForSource(f) },
          appGroup,
        );
      }
    }

    return cfg;
  });
};

module.exports = createRunOncePlugin(
  config => withShareXcode(withAppGroupInfo(withMainAppGroup(withShareFiles(config)))),
  NAME,
  VERSION,
);
