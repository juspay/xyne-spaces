const { withDangerousMod, withInfoPlist, withXcodeProject } = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');
const { getPrebuildVariant, iosAirborneOtaTaskIdentifier } = require('../config/variants.cjs');

const SOURCE_FILE = 'AirborneManager.swift';

function getAppName(config) {
  return config.name?.replace(/\s+/g, '') || 'lotus';
}

function ensureImport(contents, importLine) {
  if (contents.includes(importLine)) {
    return contents;
  }

  const lines = contents.split('\n');
  let insertAt = 0;
  while (insertAt < lines.length && lines[insertAt].startsWith('import ')) {
    insertAt += 1;
  }
  lines.splice(insertAt, 0, importLine);
  return lines.join('\n');
}

function ensureRemoteNotificationRegistrationHandlers(contents) {
  if (contents.includes('didRegisterForRemoteNotificationsWithDeviceToken')) {
    return contents;
  }

  const insertAfter =
    '  public override func application(\n' +
    '    _ application: UIApplication,\n' +
    '    didReceiveRemoteNotification userInfo: [AnyHashable: Any],\n' +
    '    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void\n' +
    '  ) {\n' +
    '    if shouldUseAirborne() && userInfo["OTA_Update"] != nil {\n' +
    '      print("[Push][OTA] Silent OTA push received: \\(userInfo)")\n' +
    '      AirborneManager.shared.handleOtaTrigger()\n' +
    '      completionHandler(.newData)\n' +
    '      return\n' +
    '    }\n\n' +
    '    print("[Push][OTA] Non-OTA remote notification received: \\(userInfo)")\n' +
    '    completionHandler(.newData)\n' +
    '  }\n';

  const methods =
    '\n  public override func application(\n' +
    '    _ application: UIApplication,\n' +
    '    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data\n' +
    '  ) {\n' +
    '    Messaging.messaging().apnsToken = deviceToken\n' +
    '    print("[Push][FCM] APNs token forwarded to Firebase")\n' +
    '    super.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken)\n' +
    '  }\n\n' +
    '  public override func application(\n' +
    '    _ application: UIApplication,\n' +
    '    didFailToRegisterForRemoteNotificationsWithError error: Error\n' +
    '  ) {\n' +
    '    print("[Push][FCM] APNs registration failed: \\(error)")\n' +
    '    super.application(application, didFailToRegisterForRemoteNotificationsWithError: error)\n' +
    '  }\n';

  if (contents.includes(insertAfter)) {
    return contents.replace(insertAfter, `${insertAfter}${methods}`);
  }

  return contents;
}

function ensureAirborneManagerLaunchSetup(contents) {
  const methodSignature =
    '  public override func application(\n' +
    '    _ application: UIApplication,\n' +
    '    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil\n' +
    '  ) -> Bool {\n';

  if (
    !contents.includes(methodSignature) ||
    contents.includes('AirborneManager.shared.configure(')
  ) {
    return contents;
  }

  const setupBlock =
    '    self.launchOptions = launchOptions\n' +
    '    logRuntimeConfiguration()\n\n' +
    '    if shouldUseAirborne() {\n' +
    '      AirborneManager.shared.configure(startAppHandler: { [weak self] indexBundleURL in\n' +
    '        self?.startReactNativeApp(indexBundleURL: indexBundleURL)\n' +
    '      })\n' +
    '      AirborneManager.shared.registerBackgroundTask()\n' +
    '      AirborneManager.shared.initialize()\n' +
    '    }\n';

  return contents.replace(methodSignature, `${methodSignature}${setupBlock}`);
}

function ensureReleaseInitUsesManager(contents) {
  if (contents.includes('if shouldUseAirborne() {')) {
    return contents;
  }

  const marker = '    UNUserNotificationCenter.current().delegate = self\n\n';
  const initBlock =
    '    UNUserNotificationCenter.current().delegate = self\n\n' +
    '    if shouldUseAirborne() {\n' +
    '      AirborneManager.shared.initialize()\n' +
    '    }\n\n';

  if (contents.includes('    initializeAirborne()\n')) {
    return contents.replace(
      '    initializeAirborne()\n',

      '    if shouldUseAirborne() {\n      AirborneManager.shared.initialize()\n    }\n',
    );
  }

  if (contents.includes(marker)) {
    return contents.replace(marker, initBlock);
  }

  return contents;
}

function ensureRemoteNotificationOtaHandling(contents) {
  const otaBlock =
    '    if shouldUseAirborne() && userInfo["OTA_Update"] != nil {\n' +
    '      print("[Push][OTA] Silent OTA push received: \\(userInfo)")\n' +
    '      AirborneManager.shared.handleOtaTrigger()\n' +
    '      completionHandler(.newData)\n' +
    '      return\n' +
    '    }\n\n' +
    '    print("[Push][OTA] Non-OTA remote notification received: \\(userInfo)")\n';

  if (contents.includes('AirborneManager.shared.handleOtaTrigger()')) {
    return contents;
  }

  const signature =
    '  public override func application(\n' +
    '    _ application: UIApplication,\n' +
    '    didReceiveRemoteNotification userInfo: [AnyHashable: Any],\n' +
    '    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void\n' +
    '  ) {';

  if (contents.includes(signature)) {
    return contents.replace(signature, `${signature}\n${otaBlock}`);
  }

  const insertAfter =
    '  public override func application(\n' +
    '    _ app: UIApplication,\n' +
    '    open url: URL,\n' +
    '    options: [UIApplication.OpenURLOptionsKey: Any] = [:]\n' +
    '  ) -> Bool {\n' +
    '    return super.application(app, open: url, options: options) || RCTLinkingManager.application(app, open: url, options: options)\n' +
    '  }\n';

  const methodBlock =
    '\n  public override func application(\n' +
    '    _ application: UIApplication,\n' +
    '    didReceiveRemoteNotification userInfo: [AnyHashable: Any],\n' +
    '    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void\n' +
    '  ) {\n' +
    otaBlock +
    '    completionHandler(.newData)\n' +
    '  }\n';

  if (contents.includes(insertAfter)) {
    return contents.replace(insertAfter, `${insertAfter}${methodBlock}`);
  }

  return contents;
}

function ensureStartReactNativeHelper(contents) {
  if (contents.includes('private func startReactNativeApp(indexBundleURL: URL?)')) {
    return contents;
  }

  const marker = '\n  // Linking API\n';
  const helperBlock =
    '\n  private func startReactNativeApp(indexBundleURL: URL?) {\n' +
    '    guard shouldUseAirborne() else {\n' +
    '      print("[Runtime] Ignoring Airborne bundle override while configuration=Debug")\n' +
    '      return\n' +
    '    }\n\n' +
    '    let delegate = ReactNativeDelegate(customPath: indexBundleURL)\n' +
    '    let factory = ExpoReactNativeFactory(delegate: delegate)\n' +
    '    delegate.dependencyProvider = RCTAppDependencyProvider()\n\n' +
    '    reactNativeDelegate = delegate\n' +
    '    reactNativeFactory = factory\n' +
    '    bindReactNativeFactory(factory)\n\n' +
    '    if window == nil {\n' +
    '      window = UIWindow(frame: UIScreen.main.bounds)\n' +
    '    }\n\n' +
    '    guard let window else { return }\n' +
    '    factory.startReactNative(\n' +
    '      withModuleName: "main",\n' +
    '      in: window,\n' +
    '      launchOptions: launchOptions\n' +
    '    )\n' +
    '  }\n\n' +
    '  private func runtimeSource() -> String {\n' +
    '#if DEBUG\n' +
    '    return "local"\n' +
    '#else\n' +
    '    return "airborne"\n' +
    '#endif\n' +
    '  }\n\n' +
    '  private func shouldUseAirborne() -> Bool {\n' +
    '    runtimeSource() == "airborne"\n' +
    '  }\n\n' +
    '  private func logRuntimeConfiguration() {\n' +
    '    let bundleId = Bundle.main.bundleIdentifier ?? "unknown"\n' +
    '    print("[Runtime] iOS source=\\(runtimeSource()) bundleId=\\(bundleId) airborneEnabled=\\(shouldUseAirborne())")\n' +
    '  }\n';

  if (contents.includes(marker)) {
    return contents.replace(marker, `${helperBlock}${marker}`);
  }

  return contents;
}

function ensureLaunchOptionsProperty(contents) {
  if (contents.includes('private var launchOptions: [UIApplication.LaunchOptionsKey: Any]?')) {
    return contents;
  }

  const marker = '  var reactNativeFactory: RCTReactNativeFactory?\n';
  if (!contents.includes(marker)) {
    return contents;
  }

  return contents.replace(
    marker,
    `${marker}\n  private var launchOptions: [UIApplication.LaunchOptionsKey: Any]?\n`,
  );
}

function ensureReactNativeDelegateSupportsCustomPath(contents) {
  let updated = contents;
  const classMarker = 'class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {\n';

  if (updated.includes(classMarker) && !updated.includes('private let customPath: URL?')) {
    updated = updated.replace(classMarker, `${classMarker}  private let customPath: URL?\n\n`);
  }

  if (!updated.includes('init(customPath: URL? = nil)')) {
    const insertAfter = '  private let customPath: URL?\n\n';
    const initBlock =
      '  init(customPath: URL? = nil) {\n' +
      '    self.customPath = customPath\n' +
      '    super.init()\n' +
      '  }\n\n';

    if (updated.includes(insertAfter)) {
      updated = updated.replace(insertAfter, `${insertAfter}${initBlock}`);
    }
  }

  const bundleMethod =
    '  override func bundleURL() -> URL? {\n' +
    '#if DEBUG\n' +
    '    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")\n' +
    '#else\n' +
    '    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")\n' +
    '#endif\n' +
    '  }\n';

  const replacement =
    '  override func bundleURL() -> URL? {\n' +
    '    if let customPath {\n' +
    '      return customPath\n' +
    '    }\n' +
    '#if DEBUG\n' +
    '    return RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: ".expo/.virtual-metro-entry")\n' +
    '#else\n' +
    '    return Bundle.main.url(forResource: "main", withExtension: "jsbundle")\n' +
    '#endif\n' +
    '  }\n';

  if (updated.includes(bundleMethod) && !updated.includes('if let customPath {')) {
    updated = updated.replace(bundleMethod, replacement);
  }

  return updated;
}

function replaceStartAppImplementation(contents) {
  const oldBlock =
    '  func startApp(indexBundleURL: URL?) {\n' +
    '    DispatchQueue.main.async { [weak self] in\n' +
    '      guard let self else { return }\n\n' +
    '      let delegate = ReactNativeDelegate(customPath: indexBundleURL)\n' +
    '      let factory = ExpoReactNativeFactory(delegate: delegate)\n' +
    '      delegate.dependencyProvider = RCTAppDependencyProvider()\n\n' +
    '      reactNativeDelegate = delegate\n' +
    '      reactNativeFactory = factory\n' +
    '      bindReactNativeFactory(factory)\n\n' +
    '      guard let window else { return }\n' +
    '      factory.startReactNative(\n' +
    '        withModuleName: "main",\n' +
    '        in: window,\n' +
    '        launchOptions: launchOptions\n' +
    '      )\n' +
    '    }\n' +
    '  }\n';

  const newBlock =
    '  func startApp(indexBundleURL: URL?) {\n' +
    '    DispatchQueue.main.async { [weak self] in\n' +
    '      self?.startReactNativeApp(indexBundleURL: indexBundleURL)\n' +
    '    }\n' +
    '  }\n';

  if (contents.includes(oldBlock)) {
    return contents.replace(oldBlock, newBlock);
  }

  return contents;
}

function removeLegacyAirborneBits(contents) {
  let updated = contents;

  updated = updated.replace('import Airborne\n', '');
  updated = updated.replace(
    /\n {2}private static let airborneReleaseURL = [^\n]+\n {2}private static let airborneNamespace = [^\n]+\n\n {2}private var airborne: AirborneServices\?\n/,
    '\n',
  );
  updated = updated.replace(
    /\n {2}private func initializeAirborne\(\) \{\n {4}airborne = AirborneServices\(\n {6}releaseConfigURL: Self\.airborneReleaseURL,\n {6}delegate: self\n {4}\)\n {2}\}\n/,
    '\n',
  );
  updated = updated.replace(
    
    /\nextension AppDelegate: AirborneDelegate \{[\s\S]*?\n\}\n(?=\nclass ReactNativeDelegate: ExpoReactNativeFactoryDelegate \{)/,
   
    '\n',
  );

  return updated;
}

function ensureRuntimeSourceGuardrails(contents) {
  let updated = contents;

  updated = updated.replace(
    '    self.launchOptions = launchOptions\n    AirborneManager.shared.configure(startAppHandler: { [weak self] indexBundleURL in\n      self?.startReactNativeApp(indexBundleURL: indexBundleURL)\n    })\n    AirborneManager.shared.registerBackgroundTask()\n    AirborneManager.shared.initialize()\n',
    '    self.launchOptions = launchOptions\n    logRuntimeConfiguration()\n\n    if shouldUseAirborne() {\n      AirborneManager.shared.configure(startAppHandler: { [weak self] indexBundleURL in\n        self?.startReactNativeApp(indexBundleURL: indexBundleURL)\n      })\n      AirborneManager.shared.registerBackgroundTask()\n      AirborneManager.shared.initialize()\n    }\n',
  );

  updated = updated.replace(
    '  private func startReactNativeApp(indexBundleURL: URL?) {\n    let delegate = ReactNativeDelegate(customPath: indexBundleURL)\n',
    '  private func startReactNativeApp(indexBundleURL: URL?) {\n    guard shouldUseAirborne() else {\n      print("[Runtime] Ignoring Airborne bundle override while configuration=Debug")\n      return\n    }\n\n    let delegate = ReactNativeDelegate(customPath: indexBundleURL)\n',
  );

  if (!updated.includes('private func shouldUseAirborne() -> Bool {')) {
    updated = updated.replace(
      '\n  // Linking API\n',
      '\n  private func runtimeSource() -> String {\n#if DEBUG\n    return "local"\n#else\n    return "airborne"\n#endif\n  }\n\n  private func shouldUseAirborne() -> Bool {\n    runtimeSource() == "airborne"\n  }\n\n  private func logRuntimeConfiguration() {\n    let bundleId = Bundle.main.bundleIdentifier ?? "unknown"\n    print("[Runtime] iOS source=\\(runtimeSource()) bundleId=\\(bundleId) airborneEnabled=\\(shouldUseAirborne())")\n  }\n\n  // Linking API\n',
    );
  }

  updated = updated.replace(
    '    if userInfo["OTA_Update"] != nil {\n',
    '    if shouldUseAirborne() && userInfo["OTA_Update"] != nil {\n',
  );

  updated = updated.replace(
    '  private func runtimeSource() -> String {\n    let source = (Bundle.main.object(forInfoDictionaryKey: "XyneRuntimeSource") as? String)?.lowercased()\n    return source == "airborne" ? "airborne" : "local"\n  }\n\n  private func isAirborneEnabled() -> Bool {\n    runtimeSource() == "airborne"\n  }\n\n  private func logRuntimeConfiguration() {\n    let bundleId = Bundle.main.bundleIdentifier ?? "unknown"\n    print("[Runtime] iOS source=\\(runtimeSource()) bundleId=\\(bundleId) airborneEnabled=\\(isAirborneEnabled())")\n  }\n',
    '  private func runtimeSource() -> String {\n#if DEBUG\n    return "local"\n#else\n    return "airborne"\n#endif\n  }\n\n  private func shouldUseAirborne() -> Bool {\n    runtimeSource() == "airborne"\n  }\n\n  private func logRuntimeConfiguration() {\n    let bundleId = Bundle.main.bundleIdentifier ?? "unknown"\n    print("[Runtime] iOS source=\\(runtimeSource()) bundleId=\\(bundleId) airborneEnabled=\\(shouldUseAirborne())")\n  }\n',
  );

  return updated;
}

function patchAppDelegate(contents) {
  let updated = contents;
  updated = ensureLaunchOptionsProperty(updated);
  updated = ensureAirborneManagerLaunchSetup(updated);
  updated = ensureReleaseInitUsesManager(updated);
  updated = ensureStartReactNativeHelper(updated);
  updated = ensureRemoteNotificationOtaHandling(updated);
  updated = ensureRemoteNotificationRegistrationHandlers(updated);
  updated = replaceStartAppImplementation(updated);
  updated = ensureReactNativeDelegateSupportsCustomPath(updated);
  updated = ensureRuntimeSourceGuardrails(updated);
  updated = removeLegacyAirborneBits(updated);
  updated = ensureImport(updated, 'import BackgroundTasks');
  updated = ensureImport(updated, 'import Firebase');
  return updated;
}

function withAirborneManagerFile(config) {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const { projectRoot, platformProjectRoot } = config.modRequest;
      const appName = getAppName(config);
      const sourcePath = path.join(projectRoot, 'plugins', 'ios-modules', SOURCE_FILE);
      const targetDir = path.join(platformProjectRoot, appName);
      const targetPath = path.join(targetDir, SOURCE_FILE);

      if (fs.existsSync(sourcePath)) {
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        fs.copyFileSync(sourcePath, targetPath);
        const v = getPrebuildVariant();
        const taskId = iosAirborneOtaTaskIdentifier(v);
        let swift = fs.readFileSync(targetPath, 'utf8');
        swift = swift.replace(
          /private static let backgroundTaskIdentifier = "[^"]*"/,
          `private static let backgroundTaskIdentifier = "${taskId}"`,
        );
        fs.writeFileSync(targetPath, swift, 'utf8');
      }

      return config;
    },
  ]);
}

function withAirborneManagerXcode(config) {
  return withXcodeProject(config, config => {
    const project = config.modResults;
    const appName = getAppName(config);
    const filePath = path.join(appName, SOURCE_FILE);
    const targetUuid = project.getFirstTarget().uuid;
    const groupKey =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject()?.firstProject?.mainGroup;
    if (!groupKey) {
      throw new Error('[withAirborneOTAIOS] Could not resolve PBX group (mainGroup missing).');
    }

    if (!project.hasFile(filePath)) {
      project.addSourceFile(
        filePath,
        { target: targetUuid, lastKnownFileType: 'sourcecode.swift' },
        groupKey,
      );
    }

    return config;
  });
}

function withAirborneInfoPlist(config) {
  const v = getPrebuildVariant();
  const taskId = iosAirborneOtaTaskIdentifier(v);

  return withInfoPlist(config, config => {
    const infoPlist = config.modResults;
    infoPlist.UIBackgroundModes = Array.from(
      new Set([...(infoPlist.UIBackgroundModes || []), 'fetch', 'remote-notification', 'voip']),
    );
    infoPlist.BGTaskSchedulerPermittedIdentifiers = Array.from(
      new Set([...(infoPlist.BGTaskSchedulerPermittedIdentifiers || []), taskId]),
    );
    infoPlist.LSApplicationQueriesSchemes = Array.from(
      new Set([...(infoPlist.LSApplicationQueriesSchemes || []), 'devtools'])
    );
    return config;
  });
}

function withAirborneAppDelegate(config) {
  return withDangerousMod(config, [
    'ios',
    async config => {
      const { platformProjectRoot } = config.modRequest;
      const appName = getAppName(config);
      const appDelegatePath = path.join(platformProjectRoot, appName, 'AppDelegate.swift');

      const currentContents = readFileIfExists(appDelegatePath);
      if (currentContents === null) {
        return config;
      }
      const updatedContents = patchAppDelegate(currentContents);

      if (updatedContents !== currentContents) {
        fs.writeFileSync(appDelegatePath, updatedContents);
      }

      return config;
    },
  ]);
}

module.exports = function withAirborneOTAIOS(config) {
  config = withAirborneInfoPlist(config);
  config = withAirborneManagerFile(config);
  config = withAirborneManagerXcode(config);
  config = withAirborneAppDelegate(config);
  return config;
};
