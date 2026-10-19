import type { LogFields } from '../types';
import type { BatterySnapshot } from './Battery';
import type { NetworkSnapshot } from './Network';

export type DeviceEnvironmentSnapshot = Readonly<{
  battery: BatterySnapshot | null;
  network: NetworkSnapshot | null;
}>;

function toBatteryPercent(level: number | null): number | undefined {
  if (level === null || !Number.isFinite(level) || level < 0) {
    return undefined;
  }

  return Math.round(Math.min(1, level) * 100);
}

function compactEnvironmentFields(
  fields: Readonly<Record<string, string | number | boolean | undefined>>,
): LogFields {
  const compact: Record<string, string | number | boolean> = {};

  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      compact[key] = value;
    }
  }

  return compact;
}

export function toDeviceEnvironmentLogFields(snapshot: DeviceEnvironmentSnapshot): LogFields {
  const batteryLevel = snapshot.battery ? toBatteryPercent(snapshot.battery.level) : undefined;
  const batteryState =
    snapshot.battery && snapshot.battery.state !== 'unknown' ? snapshot.battery.state : undefined;
  const networkType = snapshot.network?.type
    ? snapshot.network.type.trim().toLowerCase()
    : undefined;

  return compactEnvironmentFields({
    batteryLevel,
    batteryState,
    lowPowerMode: snapshot.battery?.lowPowerMode,
    networkType: networkType && networkType !== 'unknown' ? networkType : undefined,
    isInternetReachable: snapshot.network?.isInternetReachable ?? undefined,
  });
}
