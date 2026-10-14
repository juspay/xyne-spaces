import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toStaticDeviceLogContext } from './toStaticDeviceLogContext';

describe('toStaticDeviceLogContext', () => {
  it('prefers native device values over Expo fallbacks', () => {
    const fields = toStaticDeviceLogContext({
      serviceName: 'xynespaces-native',
      osName: 'android',
      fallbackOsVersion: '36',
      fallbackAppVersion: '100.0.0',
      fallbackBuildVersion: 'unknown',
      buildType: 'dev',
      sessionId: 'session-1',
      device: {
        brand: 'Google',
        model: 'Pixel 8',
        osVersion: '16',
        appVersion: '100.0.0',
        buildVersion: '123',
      },
    });

    assert.deepEqual(fields, {
      serviceName: 'xynespaces-native',
      platformName: 'native',
      osName: 'android',
      osVersion: '16',
      appVersion: '100.0.0',
      buildVersion: '123',
      buildType: 'dev',
      brand: 'Google',
      model: 'Pixel 8',
      sessionId: 'session-1',
    });
  });

  it('omits unknown device fields instead of logging placeholders', () => {
    const fields = toStaticDeviceLogContext({
      serviceName: 'xynespaces-native',
      osName: 'ios',
      fallbackOsVersion: 'unknown',
      fallbackAppVersion: '1.0.0',
      fallbackBuildVersion: 'unknown',
      buildType: 'release',
      sessionId: 'session-2',
      device: {
        brand: '',
        model: 'unknown',
        osVersion: '',
        appVersion: '',
        buildVersion: '',
      },
    });

    assert.deepEqual(fields, {
      serviceName: 'xynespaces-native',
      platformName: 'native',
      osName: 'ios',
      appVersion: '1.0.0',
      buildType: 'release',
      sessionId: 'session-2',
    });
  });
});
