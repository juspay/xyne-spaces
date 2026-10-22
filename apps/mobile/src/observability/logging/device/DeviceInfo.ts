export type DeviceInfoSnapshot = Readonly<{
  brand: string;
  model: string;
  osVersion: string;
  appVersion: string;
  buildVersion: string;
}>;

export interface DeviceInfoSource {
  snapshot(): DeviceInfoSnapshot;
}
