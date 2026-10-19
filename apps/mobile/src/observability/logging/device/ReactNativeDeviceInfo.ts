import DeviceInfo from 'react-native-device-info';

import type { DeviceInfoSnapshot, DeviceInfoSource } from './DeviceInfo';

function readDeviceString(read: () => string): string {
  try {
    const value = read().trim();
    return value.length > 0 ? value : '';
  } catch {
    return '';
  }
}

export class ReactNativeDeviceInfo implements DeviceInfoSource {
  snapshot(): DeviceInfoSnapshot {
    return {
      brand: readDeviceString(() => DeviceInfo.getManufacturerSync()),
      model: readDeviceString(() => DeviceInfo.getModel()),
      osVersion: readDeviceString(() => DeviceInfo.getSystemVersion()),
      appVersion: readDeviceString(() => DeviceInfo.getVersion()),
      buildVersion: readDeviceString(() => DeviceInfo.getBuildNumber()),
    };
  }
}
