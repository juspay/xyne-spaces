const {
  createRunOncePlugin,
  withDangerousMod,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

const PLUGIN_NAME = 'with-app-startup-timings-ios';
const PLUGIN_VERSION = '1.1.1';

function resolveProjectName(config) {
  const fromModRequest = config?.modRequest?.projectName;
  if (fromModRequest) return fromModRequest;

  const iosDir = path.join(config.modRequest.projectRoot, 'ios');
  if (!fs.existsSync(iosDir)) return null;

  const xcodeproj = fs.readdirSync(iosDir).find(entry => entry.endsWith('.xcodeproj'));
  if (!xcodeproj) return null;
  return xcodeproj.replace(/\.xcodeproj$/, '');
}

function buildAppStartupTimesSwift() {
  return `import UIKit

@objc(AppStartupTimes)
class AppStartupTimes: NSObject {
  @objc static var appUptimeMs: NSNumber?
  @objc static var activityUptimeMs: NSNumber?
  @objc static var airborneInitStartUptimeMs: NSNumber?
  @objc static var airborneInitEndUptimeMs: NSNumber?
  @objc static var airborneStartAppUptimeMs: NSNumber?
  @objc static var isBackgrounded: Bool = false
  @objc static var launchCause: String = "direct"

  private static var hasObservedActivation = false

  @objc static func resolveLaunchCause(_ launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> String {
    guard let launchOptions = launchOptions else { return "direct" }
    if launchOptions[.remoteNotification] != nil { return "notification" }
    if let url = launchOptions[.url] as? URL {
      let value = url.absoluteString
      if value.contains("share-target") { return "share" }
      if value.contains("/call/") { return "call" }
      return "deeplink"
    }
    if launchOptions[.userActivityDictionary] != nil { return "deeplink" }
    return "direct"
  }

  @objc static func setupActivationObserver() {
    guard !hasObservedActivation else { return }
    hasObservedActivation = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleActivation),
      name: UIApplication.didBecomeActiveNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(handleResignation),
      name: UIApplication.willResignActiveNotification,
      object: nil
    )
  }

  @objc private static func handleActivation() {
    guard activityUptimeMs == nil else { return }
    activityUptimeMs = NSNumber(value: nowUptimeMs())
  }

  @objc private static func handleResignation() {
    isBackgrounded = true
  }

  @objc static func nowUptimeMs() -> Double {
    return ProcessInfo.processInfo.systemUptime * 1000.0
  }
}
`;
}

function buildAppStartupModuleSwift() {
  return `import Foundation
import React

@objc(AppStartupModule)
class AppStartupModule: NSObject {
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }

  @objc(getLaunchTimes:reject:)
  func getLaunchTimes(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    let now = AppStartupTimes.nowUptimeMs()
    var result: [String: Any] = [
      "platform": "ios",
      "jsCallUptimeMs": now
    ]
    if let v = AppStartupTimes.appUptimeMs { result["appUptimeMs"] = v.doubleValue }
    if let v = AppStartupTimes.activityUptimeMs { result["activityUptimeMs"] = v.doubleValue }
    if let v = AppStartupTimes.airborneInitStartUptimeMs { result["airborneInitStartUptimeMs"] = v.doubleValue }
    if let v = AppStartupTimes.airborneInitEndUptimeMs { result["airborneInitEndUptimeMs"] = v.doubleValue }
    if let v = AppStartupTimes.airborneStartAppUptimeMs { result["airborneStartAppUptimeMs"] = v.doubleValue }
    result["isBackgrounded"] = AppStartupTimes.isBackgrounded
    result["launchCause"] = AppStartupTimes.launchCause
    resolve(result)
  }

  @objc(nowUptimeMs:reject:)
  func nowUptimeMs(
    _ resolve: @escaping RCTPromiseResolveBlock,
    reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(AppStartupTimes.nowUptimeMs())
  }
}
`;
}

function buildAppStartupModuleObjC() {
  return `#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(AppStartupModule, NSObject)

RCT_EXTERN_METHOD(getLaunchTimes:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(nowUptimeMs:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)

@end
`;
}

function ensureLaunchUptimeInAppDelegate(contents) {
  if (contents.includes('AppStartupTimes.appUptimeMs')) return contents;

  const lines = contents.split('\n');

  // Try the legacy marker first (backward compat with older AppDelegates)
  const legacyMarker = 'self.launchOptions = launchOptions';
  if (contents.includes(legacyMarker)) {
    const lineIndex = lines.findIndex(line => line.includes(legacyMarker));
    if (lineIndex !== -1) {
      const indent = lines[lineIndex].match(/^(\s*)/)[1];
      lines.splice(lineIndex + 1, 0, `${indent}AppStartupTimes.appUptimeMs = NSNumber(value: AppStartupTimes.nowUptimeMs())`);
      return lines.join('\n');
    }
  }

  // Fallback: inject right after the opening brace of didFinishLaunchingWithOptions
  const didFinishIndex = lines.findIndex(line => line.includes('didFinishLaunchingWithOptions'));
  if (didFinishIndex === -1) return contents;

  let braceIndex = -1;
  for (let i = didFinishIndex; i < lines.length; i++) {
    if (lines[i].includes('{')) {
      braceIndex = i;
      break;
    }
  }
  if (braceIndex === -1) return contents;

  const indent = lines[braceIndex + 1]?.match(/^(\s*)/)?.[1] || '    ';
  lines.splice(braceIndex + 1, 0, `${indent}AppStartupTimes.appUptimeMs = NSNumber(value: AppStartupTimes.nowUptimeMs())`);

  return lines.join('\n');
}

function ensureAirborneTimingsInAppDelegate(contents) {
  if (contents.includes('AppStartupTimes.airborneInitStartUptimeMs')) {
    return contents;
  }

  // Inject around Airborne initialize call if present.
  const initCall = 'AirborneManager.shared.initialize()';
  if (!contents.includes(initCall)) return contents;

  const lines = contents.split('\n');
  const lineIndex = lines.findIndex(line => line.includes(initCall));
  if (lineIndex === -1) return contents;
  
  const indent = lines[lineIndex].match(/^(\s*)/)[1];
  lines.splice(lineIndex, 0, `${indent}AppStartupTimes.airborneInitStartUptimeMs = NSNumber(value: AppStartupTimes.nowUptimeMs())`);
  lines.splice(lineIndex + 2, 0, `${indent}AppStartupTimes.airborneInitEndUptimeMs = NSNumber(value: AppStartupTimes.nowUptimeMs())`);
  
  return lines.join('\n');
}

function ensureAirborneStartAppInAppDelegate(contents) {
  if (contents.includes('AppStartupTimes.airborneStartAppUptimeMs')) {
    return contents;
  }

  const marker = 'AirborneManager.shared.configure(startAppHandler: { [weak self] indexBundleURL in';
  if (!contents.includes(marker)) {
    return contents;
  }

  const lines = contents.split('\n');
  const lineIndex = lines.findIndex(line => line.includes(marker));
  if (lineIndex === -1) return contents;
  
  // Get indentation of the next line (the line after the closure opening)
  const nextLineIndent = lines[lineIndex + 1]?.match(/^(\s*)/)?.[1] || '';
  lines.splice(lineIndex + 1, 0, `${nextLineIndent}AppStartupTimes.airborneStartAppUptimeMs = NSNumber(value: AppStartupTimes.nowUptimeMs())`);
  
  return lines.join('\n');
}

function ensureLaunchCauseInAppDelegate(contents) {
  if (contents.includes('AppStartupTimes.launchCause')) return contents;

  const marker = 'AppStartupTimes.appUptimeMs = NSNumber(value: AppStartupTimes.nowUptimeMs())';
  if (!contents.includes(marker)) return contents;

  const lines = contents.split('\n');
  const lineIndex = lines.findIndex(line => line.includes(marker));
  if (lineIndex === -1) return contents;

  const indent = lines[lineIndex].match(/^(\s*)/)[1];
  lines.splice(
    lineIndex + 1,
    0,
    `${indent}AppStartupTimes.launchCause = AppStartupTimes.resolveLaunchCause(launchOptions)`,
  );
  return lines.join('\n');
}

function ensureActivationObserverInAppDelegate(contents) {
  if (contents.includes('AppStartupTimes.setupActivationObserver()')) return contents;

  const marker = 'AppStartupTimes.appUptimeMs = NSNumber(value: AppStartupTimes.nowUptimeMs())';
  if (!contents.includes(marker)) return contents;

  const lines = contents.split('\n');
  const lineIndex = lines.findIndex(line => line.includes(marker));
  if (lineIndex === -1) return contents;

  const indent = lines[lineIndex].match(/^(\s*)/)[1];
  lines.splice(lineIndex + 1, 0, `${indent}AppStartupTimes.setupActivationObserver()`);

  return lines.join('\n');
}

function withAppStartupTimingsIOS(config) {
  config = withDangerousMod(config, [
    'ios',
    async config => {
      const { modRequest } = config;
      const { platformProjectRoot } = modRequest;

      const appName = config.name?.replace(/\s+/g, '') || resolveProjectName(config) || 'lotus';
      const targetDir = path.join(platformProjectRoot, appName);
      if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

      fs.writeFileSync(path.join(targetDir, 'AppStartupTimes.swift'), buildAppStartupTimesSwift());
      fs.writeFileSync(path.join(targetDir, 'AppStartupModule.swift'), buildAppStartupModuleSwift());
      fs.writeFileSync(path.join(targetDir, 'AppStartupModule.m'), buildAppStartupModuleObjC());

      const appDelegatePath = path.join(platformProjectRoot, appName, 'AppDelegate.swift');
      const prev = readFileIfExists(appDelegatePath);
      if (prev !== null) {
        let next = ensureLaunchUptimeInAppDelegate(prev);
        next = ensureLaunchCauseInAppDelegate(next);
        next = ensureAirborneTimingsInAppDelegate(next);
        next = ensureAirborneStartAppInAppDelegate(next);
        next = ensureActivationObserverInAppDelegate(next);
        if (next !== prev) fs.writeFileSync(appDelegatePath, next);
      }

      return config;
    },
  ]);

  config = withXcodeProject(config, config => {
    const project = config.modResults;
    const appName = config.name?.replace(/\s+/g, '') || resolveProjectName(config) || 'lotus';

    const files = ['AppStartupTimes.swift', 'AppStartupModule.swift', 'AppStartupModule.m'];
    const targetUuid = project.getFirstTarget().uuid;
    const group =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject()?.firstProject?.mainGroup;
    if (!group) {
      throw new Error('[with-app-startup-timings-ios] Could not resolve PBX group for native sources.');
    }

    for (const file of files) {
      const filePath = path.join(appName, file);
      if (project.hasFile(filePath)) continue;
      project.addSourceFile(
        filePath,
        { target: targetUuid, lastKnownFileType: file.endsWith('.swift') ? 'sourcecode.swift' : undefined },
        group,
      );
    }

    return config;
  });

  return config;
}

module.exports = createRunOncePlugin(withAppStartupTimingsIOS, PLUGIN_NAME, PLUGIN_VERSION);