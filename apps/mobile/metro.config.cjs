const path = require("path");

// Same as app.config.js: pick `.env.dev` | `.env.prod` | `.env.sandbox` from APP_VARIANT (defaults to prod).
// Metro must load this too so bundled output (Airborne OTA, CI, etc.) inlines prod URLs — not only `expo prebuild`.
require("./config/loadLotusEnv.cjs").loadLotusEnv();

const { getDefaultConfig } = require("expo/metro-config");
const { withUniwindConfig } = require("uniwind/metro");

const projectRoot = __dirname;
const repoRoot = path.resolve(projectRoot, "..", "..");

const config = getDefaultConfig(projectRoot);

// Watch the whole monorepo so the linked package @xyne/shared (packages/shared)
// and its dependencies are resolvable.
config.watchFolders = [repoRoot];
config.resolver ??= {};
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(repoRoot, "node_modules"),
];

// Inject DOMException polyfill before any other code runs
// This is required for livekit-client to work in React Native
const originalGetPolyfills = config.serializer?.getPolyfills;
config.serializer ??= {};
config.serializer.getPolyfills = (...args) => {
  const polyfills = originalGetPolyfills?.(...args) ?? [];
  return [path.resolve(projectRoot, "src/polyfills/DOMException.ts"), ...polyfills];
};

// Critical: Force single instance resolution for packages that create React contexts
const lotusModules = path.resolve(projectRoot, "node_modules");
config.resolver.extraNodeModules = {
  '@rocicorp/zero': path.join(lotusModules, '@rocicorp/zero'),
  '@rocicorp/zero/react': path.join(lotusModules, '@rocicorp/zero/react'),
  '@tanstack/react-query': path.join(lotusModules, '@tanstack/react-query'),
  'react': path.join(lotusModules, 'react'),
  'react-native': path.join(lotusModules, 'react-native'),
  'xstate': path.join(lotusModules, 'xstate'),
  '@xstate/react': path.join(lotusModules, '@xstate/react'),
};

// SDK 56's resolver checks the linked workspace before extraNodeModules. Force
// React itself through Lotus so @xyne/shared cannot load its own React copy and
// create hooks that run under a different dispatcher after login.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    return {
      filePath: require.resolve(moduleName, { paths: [lotusModules] }),
      type: 'sourceFile',
    };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

// Block Metro from resolving these packages from shared's node_modules
config.resolver.blockList = [
  /packages[\\/]shared[\\/]node_modules[\\/](@rocicorp|react|@tanstack|xstate|@xstate)/,
];

module.exports = withUniwindConfig(config, {
  cssEntryFile: './global.css',
  dtsFile: './uniwind-types.d.ts',
});
