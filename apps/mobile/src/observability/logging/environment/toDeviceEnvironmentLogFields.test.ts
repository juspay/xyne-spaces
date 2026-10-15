import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { toDeviceEnvironmentLogFields } from './toDeviceEnvironmentLogFields';

describe('toDeviceEnvironmentLogFields', () => {
  it('maps battery percent, charge state, and network type for Grafana', () => {
    const fields = toDeviceEnvironmentLogFields({
      battery: {
        level: 0.759,
        state: 'charging',
        lowPowerMode: false,
      },
      network: {
        type: 'WIFI',
        isInternetReachable: true,
      },
    });

    assert.deepEqual(fields, {
      batteryLevel: 76,
      batteryState: 'charging',
      lowPowerMode: false,
      networkType: 'wifi',
      isInternetReachable: true,
    });
  });

  it('omits unknown sensor values instead of logging placeholders', () => {
    const fields = toDeviceEnvironmentLogFields({
      battery: {
        level: -1,
        state: 'unknown',
        lowPowerMode: false,
      },
      network: {
        type: 'UNKNOWN',
        isInternetReachable: null,
      },
    });

    assert.deepEqual(fields, {
      lowPowerMode: false,
    });
  });

  it('omits environment fields before the first successful sensor read', () => {
    const fields = toDeviceEnvironmentLogFields({
      battery: null,
      network: null,
    });

    assert.deepEqual(fields, {});
  });
});
