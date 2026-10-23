const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const { readFileIfExists } = require('./utils/fs.cjs');
const path = require('path');

const ENV_LINE = "ENV['ENRICHED_MARKDOWN_ENABLE_MATH'] = '0'";

/**
 * Disables LaTeX math (RaTeX) in react-native-enriched-markdown on iOS.
 *
 * The package wires RaTeX in through Swift Package Manager, which its podspec
 * documents as requiring `use_frameworks! :linkage => :dynamic`. This project
 * deliberately keeps CocoaPods on static linkage (see withFirebaseModularHeaders),
 * so the Swift bridge compiles without a visible RaTeX module and the build fails
 * with `no such module 'RaTeX'` in ios/math/ENRMRaTeXBridge.swift.
 *
 * Setting ENRICHED_MARKDOWN_ENABLE_MATH=0 makes the podspec exclude
 * `ios/math/**\/*.swift` and skip the SPM dependency entirely, leaving linkage
 * untouched. Applied as a config plugin so it survives `expo prebuild --clean`.
 *
 * Pair this with `latexMath: false` in COMPOSER_MD4C_FLAGS: with math compiled
 * out, math AST nodes get a nil renderer and their content (which lives in
 * node.content, not children) would be dropped silently rather than shown as text.
 */
function withEnrichedMarkdownNoMath(config) {
  return withDangerousMod(config, [
    'ios',
    config => {
      const podfilePath = path.join(config.modRequest.projectRoot, 'ios', 'Podfile');

      const podfileContents = readFileIfExists(podfilePath);
      if (podfileContents === null) {
        return config;
      }

      if (podfileContents.includes("ENV['ENRICHED_MARKDOWN_ENABLE_MATH']")) {
        return config;
      }

      // Must be set before the podspec is evaluated, i.e. before any pod is declared.
      const marker = 'prepare_react_native_project!\n';
      if (!podfileContents.includes(marker)) {
        return config;
      }

      fs.writeFileSync(
        podfilePath,
        podfileContents.replace(marker, `${ENV_LINE}\n\n${marker}`),
      );

      return config;
    },
  ]);
}

module.exports = withEnrichedMarkdownNoMath;
