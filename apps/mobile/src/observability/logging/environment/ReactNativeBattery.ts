import * as ExpoBattery from 'expo-battery';

import type {
  Battery,
  BatteryReading,
  BatterySnapshot,
  BatterySubscription,
  LogBatteryState,
} from './Battery';

function toLogBatteryState(state: ExpoBattery.BatteryState): LogBatteryState {
  switch (state) {
    case ExpoBattery.BatteryState.UNPLUGGED:
      return 'unplugged';
    case ExpoBattery.BatteryState.CHARGING:
      return 'charging';
    case ExpoBattery.BatteryState.FULL:
      return 'full';
    case ExpoBattery.BatteryState.NOT_CHARGING:
      return 'not_charging';
    default:
      return 'unknown';
  }
}

function toBatteryLevel(level: number): number | null {
  if (!Number.isFinite(level) || level < 0) {
    return null;
  }

  return level;
}

export class ReactNativeBattery implements Battery {
  async read(): Promise<BatterySnapshot> {
    try {
      const powerState = await ExpoBattery.getPowerStateAsync();

      return {
        level: toBatteryLevel(powerState.batteryLevel),
        state: toLogBatteryState(powerState.batteryState),
        lowPowerMode: powerState.lowPowerMode,
      };
    } catch {
      return {
        level: null,
        state: 'unknown',
        lowPowerMode: false,
      };
    }
  }

  subscribe(listener: (reading: BatteryReading) => void): BatterySubscription {
    const subscriptions: Array<{ remove(): void }> = [];

    try {
      subscriptions.push(
        ExpoBattery.addBatteryLevelListener(({ batteryLevel }) => {
          listener({
            level: toBatteryLevel(batteryLevel),
          });
        }),
      );
    } catch {
      // Battery listeners must never prevent logger startup.
    }

    try {
      subscriptions.push(
        ExpoBattery.addBatteryStateListener(({ batteryState }) => {
          listener({
            state: toLogBatteryState(batteryState),
          });
        }),
      );
    } catch {
      // Battery listeners must never prevent logger startup.
    }

    try {
      subscriptions.push(
        ExpoBattery.addLowPowerModeListener(({ lowPowerMode }) => {
          listener({
            lowPowerMode,
          });
        }),
      );
    } catch {
      // Battery listeners must never prevent logger startup.
    }

    return {
      remove: (): void => {
        for (const subscription of subscriptions) {
          subscription.remove();
        }
      },
    };
  }
}
