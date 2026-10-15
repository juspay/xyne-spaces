import type { LogFields } from '../types';
import type { DeviceInfoSnapshot } from './DeviceInfo';

export type StaticDeviceLogContextInput = Readonly<{
  serviceName: string;
  osName: string;
  fallbackOsVersion: string;
  fallbackAppVersion: string;
  fallbackBuildVersion: string;
  buildType: 'dev' | 'release';
  sessionId: string;
  device: DeviceInfoSnapshot;
}>;

function firstKnown(...values: readonly string[]): string | undefined {
  for (const value of values) {
    const trimmed = value.trim();
    if (trimmed.length > 0 && trimmed !== 'unknown') {
      return trimmed;
    }
  }

  return undefined;
}

function compactStaticFields(fields: Readonly<Record<string, string | undefined>>): LogFields {
  const compact: Record<string, string> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      compact[key] = value;
    }
  }

  return compact;
}

export function toStaticDeviceLogContext(input: StaticDeviceLogContextInput): LogFields {
  return compactStaticFields({
    serviceName: input.serviceName,
    platformName: 'native',
    osName: input.osName,
    osVersion: firstKnown(input.device.osVersion, input.fallbackOsVersion),
    appVersion: firstKnown(input.device.appVersion, input.fallbackAppVersion),
    buildVersion: firstKnown(input.device.buildVersion, input.fallbackBuildVersion),
    buildType: input.buildType,
    brand: firstKnown(input.device.brand),
    model: firstKnown(input.device.model),
    sessionId: input.sessionId,
  });
}
