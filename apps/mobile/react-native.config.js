module.exports = {
  dependencies: {
    // react-native-file-viewer is only used on iOS (QuickLook preview). Disable
    // its Android autolinking so its bundled FileProvider (authority
    // `${applicationId}.provider`) can't clash with another provider and break
    // installs (INSTALL_FAILED_CONFLICTING_PROVIDER). On Android we open
    // documents via openInDeviceViewer (ACTION_VIEW) instead.
    'react-native-file-viewer': {
      platforms: { android: null },
    },
  },
};
