const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

function withFirebaseModularHeaders(config) {
  return withDangerousMod(config, [
    'ios',
    config => {
      const podfilePath = path.join(config.modRequest.projectRoot, 'ios', 'Podfile');

      let podfileContents = readFileIfExists(podfilePath);
      if (podfileContents === null) {
        return config;
      }
      let modified = false;

      // Inject $RNFirebaseAsStaticFramework = true before prepare_react_native_project!
      // This makes Firebase pods build as static frameworks WITHOUT forcing
      if (!podfileContents.includes('$RNFirebaseAsStaticFramework')) {
        const staticFrameworkMarker = 'prepare_react_native_project!\n';
        if (podfileContents.includes(staticFrameworkMarker)) {
          podfileContents = podfileContents.replace(
            staticFrameworkMarker,
            '$RNFirebaseAsStaticFramework = true\n\n' + staticFrameworkMarker,
          );
          modified = true;
        }
      }

      const podsBlock = [
        "  pod 'GoogleUtilities', :modular_headers => true",
        "  pod 'FirebaseCore', :modular_headers => true",
        "  pod 'FirebaseCoreInternal', :modular_headers => true",
        "  pod 'FirebaseInstallations', :modular_headers => true",
        "  pod 'FirebaseMessaging', :modular_headers => true",
        "  pod 'GoogleDataTransport', :modular_headers => true",
        "  pod 'nanopb', :modular_headers => true",
        "  pod 'AppCheckCore', :modular_headers => true",
        "  pod 'RecaptchaInterop', :modular_headers => true",
      ].join('\n');

      if (!podfileContents.includes("pod 'FirebaseMessaging', :modular_headers => true")) {
        const marker = '  use_expo_modules!\n';
        if (podfileContents.includes(marker)) {
          podfileContents = podfileContents.replace(marker, `${marker}\n${podsBlock}\n`);
          modified = true;
        }
      }

      if (modified) {
        fs.writeFileSync(podfilePath, podfileContents);
      }

      return config;
    },
  ]);
}

module.exports = withFirebaseModularHeaders;
