const {
  createRunOncePlugin,
  withDangerousMod,
  withInfoPlist,
  withXcodeProject,
} = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

// The Xcode 27 SDK requires UIScene adoption on iOS 27. React Native still starts in
// didFinishLaunching so background launches (PushKit VoIP) run JS; the SceneDelegate only owns the window.
const PLUGIN_NAME = 'with-scene-delegate-ios';
const PLUGIN_VERSION = '1.0.0';

const REACT_NATIVE_START_BLOCK = `    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)`;

const REACT_NATIVE_START_REPLACEMENT = `    let rootView = factory.rootViewFactory.view(
      withModuleName: "main",
      initialProperties: nil,
      launchOptions: launchOptions)
    let rootViewController = delegate.createRootViewController()
    delegate.setRootView(rootView, toRootViewController: rootViewController)
    self.rootViewController = rootViewController`;

const SCENE_DELEGATE_SWIFT = `import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  var window: UIWindow?

  private var appDelegate: AppDelegate? {
    UIApplication.shared.delegate as? AppDelegate
  }

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    guard let windowScene = scene as? UIWindowScene, let appDelegate else { return }

    let window = UIWindow(windowScene: windowScene)
    window.rootViewController = appDelegate.rootViewController
    window.makeKeyAndVisible()
    self.window = window
    appDelegate.window = window

    // Cold-start links arrive here instead of in launchOptions.
    open(connectionOptions.urlContexts)
    connectionOptions.userActivities.forEach { continueActivity($0) }
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    open(URLContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    continueActivity(userActivity)
  }

  // React Native outlives the scene, so release the window before a reconnect reuses the root view controller.
  func sceneDidDisconnect(_ scene: UIScene) {
    window?.rootViewController = nil
    window = nil
    appDelegate?.window = nil
  }

  private func open(_ contexts: Set<UIOpenURLContext>) {
    for context in contexts {
      var options: [UIApplication.OpenURLOptionsKey: Any] = [.openInPlace: context.options.openInPlace]
      if let sourceApplication = context.options.sourceApplication {
        options[.sourceApplication] = sourceApplication
      }
      if let annotation = context.options.annotation {
        options[.annotation] = annotation
      }
      _ = appDelegate?.application(UIApplication.shared, open: context.url, options: options)
    }
  }

  private func continueActivity(_ userActivity: NSUserActivity) {
    _ = appDelegate?.application(UIApplication.shared, continue: userActivity) { _ in }
  }
}
`;

function resolveProjectName(config) {
  const fromModRequest = config?.modRequest?.projectName;
  if (fromModRequest) return fromModRequest;

  const iosDir = path.join(config.modRequest.projectRoot, 'ios');
  if (!fs.existsSync(iosDir)) return null;

  const xcodeproj = fs.readdirSync(iosDir).find(entry => entry.endsWith('.xcodeproj'));
  if (!xcodeproj) return null;
  return xcodeproj.replace(/\.xcodeproj$/, '');
}

function resolveAppName(config) {
  return config.name?.replace(/\s+/g, '') || resolveProjectName(config) || 'lotus';
}

function patchAppDelegate(contents) {
  let next = contents;

  if (!next.includes('var rootViewController: UIViewController?')) {
    const anchor = '  var reactNativeFactory: RCTReactNativeFactory?';
    if (!next.includes(anchor)) {
      throw new Error(`[${PLUGIN_NAME}] Could not find "${anchor.trim()}" in AppDelegate.swift.`);
    }
    next = next.replace(anchor, `${anchor}\n  var rootViewController: UIViewController?`);
  }

  if (!next.includes('self.rootViewController = rootViewController')) {
    if (!next.includes(REACT_NATIVE_START_BLOCK)) {
      throw new Error(
        `[${PLUGIN_NAME}] AppDelegate.swift no longer matches the expected Expo template; update the plugin.`,
      );
    }
    next = next.replace(REACT_NATIVE_START_BLOCK, () => REACT_NATIVE_START_REPLACEMENT);
  }

  return next;
}

function withSceneDelegateIOS(config) {
  config = withInfoPlist(config, config => {
    config.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: '$(PRODUCT_MODULE_NAME).SceneDelegate',
          },
        ],
      },
    };
    return config;
  });

  config = withDangerousMod(config, [
    'ios',
    async config => {
      const { platformProjectRoot } = config.modRequest;
      const appName = resolveAppName(config);
      const targetDir = path.join(platformProjectRoot, appName);

      fs.writeFileSync(path.join(targetDir, 'SceneDelegate.swift'), SCENE_DELEGATE_SWIFT);

      const appDelegatePath = path.join(targetDir, 'AppDelegate.swift');
      const prev = readFileIfExists(appDelegatePath);
      if (prev === null) {
        throw new Error(`[${PLUGIN_NAME}] ${appDelegatePath} not found.`);
      }
      const next = patchAppDelegate(prev);
      if (next !== prev) fs.writeFileSync(appDelegatePath, next);

      return config;
    },
  ]);

  config = withXcodeProject(config, config => {
    const project = config.modResults;
    const appName = resolveAppName(config);
    const targetUuid = project.getFirstTarget().uuid;
    const group =
      project.findPBXGroupKey({ name: appName }) ||
      project.getFirstProject()?.firstProject?.mainGroup;
    if (!group) {
      throw new Error(`[${PLUGIN_NAME}] Could not resolve PBX group for SceneDelegate.swift.`);
    }

    const filePath = path.join(appName, 'SceneDelegate.swift');
    if (!project.hasFile(filePath)) {
      project.addSourceFile(
        filePath,
        { target: targetUuid, lastKnownFileType: 'sourcecode.swift' },
        group,
      );
    }

    return config;
  });

  return config;
}

module.exports = createRunOncePlugin(withSceneDelegateIOS, PLUGIN_NAME, PLUGIN_VERSION);
