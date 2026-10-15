const { createRunOncePlugin, withAndroidManifest } = require('@expo/config-plugins');

const PLUGIN_NAME = 'with-screen-share-android';
const PLUGIN_VERSION = '1.0.0';

function withScreenShareAndroid(config) {
  // Add permissions to AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    
    // Add required permissions for screen sharing
    const permissions = [
      'android.permission.FOREGROUND_SERVICE',
      'android.permission.FOREGROUND_SERVICE_MEDIA_PROJECTION',
      'android.permission.PROJECT_MEDIA',
    ];
    
    if (!manifest['uses-permission']) {
      manifest['uses-permission'] = [];
    }
    
    permissions.forEach((permission) => {
      const exists = manifest['uses-permission'].some(
        (p) => p.$['android:name'] === permission
      );
      if (!exists) {
        manifest['uses-permission'].push({ $: { 'android:name': permission } });
      }
    });
    
    // Add foreground service to application
    if (!manifest.application) {
      manifest.application = [];
    }
    
    const application = manifest.application[0];
    if (!application.service) {
      application.service = [];
    }
    
    // Add screen capture service for LiveKit
    const screenCaptureService = {
      $: {
        'android:name': 'com.livekit.reactnative.ScreenCaptureService',
        'android:enabled': 'true',
        'android:exported': 'false',
        'android:foregroundServiceType': 'mediaProjection',
      },
    };
    
    const exists = application.service.some(
      (s) => s.$['android:name'] === 'com.livekit.reactnative.ScreenCaptureService'
    );
    
    if (!exists) {
      application.service.push(screenCaptureService);
    }
    
    return config;
  });
  return config;
}

module.exports = createRunOncePlugin(withScreenShareAndroid, PLUGIN_NAME, PLUGIN_VERSION);