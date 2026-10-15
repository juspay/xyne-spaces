const { createRunOncePlugin, withProjectBuildGradle } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-async-storage-local-repo';
const PLUGIN_VERSION = '1.0.0';
const ASYNC_STORAGE_LOCAL_REPO =
  'maven { url("$rootDir/../node_modules/@react-native-async-storage/async-storage/android/local_repo") }';

function withAsyncStorageLocalRepo(config) {
  return withProjectBuildGradle(config, config => {
    if (config.modResults.language !== 'groovy') {
      return config;
    }

    const contents = config.modResults.contents;
    if (contents.includes('@react-native-async-storage/async-storage/android/local_repo')) {
      return config;
    }

    config.modResults.contents = contents.replace(
      /mavenCentral\(\)/g,
      match => `${match}\n    ${ASYNC_STORAGE_LOCAL_REPO}`,
    );

    return config;
  });
}

module.exports = createRunOncePlugin(withAsyncStorageLocalRepo, PLUGIN_NAME, PLUGIN_VERSION);
