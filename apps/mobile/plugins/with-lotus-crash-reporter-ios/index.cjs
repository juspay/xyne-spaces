const {
  createRunOncePlugin,
  withDangerousMod,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('../utils/fs.cjs');
const path = require('path');

const PLUGIN_NAME = 'with-lotus-crash-reporter-ios';
const PLUGIN_VERSION = '1.0.0';

function resolveProjectName(config) {
  const fromModRequest = config?.modRequest?.projectName;
  if (fromModRequest) return fromModRequest;

  const iosDir = path.join(config.modRequest.projectRoot, 'ios');
  if (!fs.existsSync(iosDir)) return null;

  const xcodeproj = fs.readdirSync(iosDir).find(entry => entry.endsWith('.xcodeproj'));
  if (!xcodeproj) return null;
  return xcodeproj.replace(/\.xcodeproj$/, '');
}

/**
 * Copy CrashReporter source files from plugins/ios-modules/ into the Xcode project.
 */
const withCrashReporterFiles = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const { modRequest } = config;
      const { projectRoot, platformProjectRoot } = modRequest;

      const sourceDir = path.join(projectRoot, 'plugins', 'ios-modules');
      const appName = config.name?.replace(/\s+/g, '') || resolveProjectName(config) || 'lotus';
      const targetDir = path.join(platformProjectRoot, appName);

      if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
      }

      const files = ['CrashReporter.h', 'CrashReporter.m', 'CrashReporter.swift'];

      for (const file of files) {
        const sourcePath = path.join(sourceDir, file);
        const targetPath = path.join(targetDir, file);

        if (fs.existsSync(sourcePath)) {
          fs.copyFileSync(sourcePath, targetPath);
          console.log(`[${PLUGIN_NAME}] Copied ${file}`);
        } else {
          console.warn(`[${PLUGIN_NAME}] Source file not found: ${sourcePath}`);
        }
      }

      return config;
    },
  ]);
};

/**
 * Add copied source files to the Xcode project.
 */
const withCrashReporterXcode = config => {
  return withXcodeProject(config, config => {
    const project = config.modResults;
    const appName = config.name?.replace(/\s+/g, '') || resolveProjectName(config) || 'lotus';

    const files = ['CrashReporter.h', 'CrashReporter.m', 'CrashReporter.swift'];
    const targetUuid = project.getFirstTarget().uuid;
    const group =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject()?.firstProject?.mainGroup;

    if (!group) {
      throw new Error(`[${PLUGIN_NAME}] Could not resolve PBX group for native sources.`);
    }

    for (const file of files) {
      const filePath = path.join(appName, file);
      if (project.hasFile(filePath)) {
        console.log(`[${PLUGIN_NAME}] ${file} already in project`);
        continue;
      }

      const fileOptions = {
        target: targetUuid,
        lastKnownFileType: file.endsWith('.swift')
          ? 'sourcecode.swift'
          : file.endsWith('.h')
            ? 'sourcecode.c.h'
            : 'sourcecode.c.objc',
      };

      project.addSourceFile(filePath, fileOptions, group);
      console.log(`[${PLUGIN_NAME}] Added ${file} to Xcode project`);
    }

    return config;
  });
};

/**
 * Add #import "CrashReporter.h" to the bridging header so Swift can see the
 * C function declaration crashreporter_install_handlers().
 */
const withCrashReporterBridgingHeader = config => {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const { modRequest } = config;
      const { platformProjectRoot } = modRequest;
      const appName = config.name?.replace(/\s+/g, '') || resolveProjectName(config) || 'lotus';

      const bridgeHeaderPath = path.join(
        platformProjectRoot,
        appName,
        `${appName}-Bridging-Header.h`
      );

      const contents = readFileIfExists(bridgeHeaderPath);
      if (contents === null) {
        console.warn(`[${PLUGIN_NAME}] Bridging header not found: ${bridgeHeaderPath}`);
        return config;
      }

      const importLine = '#import "CrashReporter.h"';

      if (!contents.includes(importLine)) {
        fs.writeFileSync(bridgeHeaderPath, `${contents.trimEnd()}\n${importLine}\n`);
        console.log(`[${PLUGIN_NAME}] Added CrashReporter.h import to bridging header`);
      }

      return config;
    },
  ]);
};

function withLotusCrashReporterIOS(config) {
  config = withCrashReporterFiles(config);
  config = withCrashReporterXcode(config);
  config = withCrashReporterBridgingHeader(config);
  return config;
}

module.exports = createRunOncePlugin(
  withLotusCrashReporterIOS,
  PLUGIN_NAME,
  PLUGIN_VERSION
);
