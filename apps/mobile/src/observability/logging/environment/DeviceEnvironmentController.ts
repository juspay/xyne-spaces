import type { MutableLogContextStore } from '../context/LogContextStore';
import type { Battery, BatteryReading, BatterySnapshot, BatterySubscription } from './Battery';
import type { Network, NetworkSnapshot, NetworkSubscription } from './Network';
import { toDeviceEnvironmentLogFields } from './toDeviceEnvironmentLogFields';

export const DEVICE_ENVIRONMENT_CONTEXT_KEYS = [
  'batteryLevel',
  'batteryState',
  'lowPowerMode',
  'networkType',
  'isInternetReachable',
] as const;

export type DeviceEnvironmentControllerOptions = Readonly<{
  battery: Battery;
  network: Network;
  contextStore: MutableLogContextStore;
}>;

export class DeviceEnvironmentController {
  private readonly battery: Battery;
  private readonly network: Network;
  private readonly contextStore: MutableLogContextStore;

  private batterySnapshot: BatterySnapshot | null = null;
  private networkSnapshot: NetworkSnapshot | null = null;
  private batterySubscription: BatterySubscription | null = null;
  private networkSubscription: NetworkSubscription | null = null;
  private refreshInFlight: Promise<void> | null = null;
  private started = false;

  constructor(options: DeviceEnvironmentControllerOptions) {
    this.battery = options.battery;
    this.network = options.network;
    this.contextStore = options.contextStore;
  }

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;

    this.batterySubscription = this.battery.subscribe((reading): void => {
      this.mergeBatteryReading(reading);
      this.write();
    });

    this.networkSubscription = this.network.subscribe((snapshot): void => {
      this.networkSnapshot = snapshot;
      this.write();
    });

    await this.refresh();
  }

  stop(): void {
    if (!this.started) {
      return;
    }

    this.started = false;
    this.batterySubscription?.remove();
    this.networkSubscription?.remove();
    this.batterySubscription = null;
    this.networkSubscription = null;
    this.batterySnapshot = null;
    this.networkSnapshot = null;
    this.contextStore.unset(DEVICE_ENVIRONMENT_CONTEXT_KEYS);
  }

  private async refresh(): Promise<void> {
    if (this.refreshInFlight !== null) {
      return this.refreshInFlight;
    }

    this.refreshInFlight = this.readSensors()
      .then((): void => {
        this.write();
      })
      .finally((): void => {
        this.refreshInFlight = null;
      });

    return this.refreshInFlight;
  }

  private async readSensors(): Promise<void> {
    const [battery, network] = await Promise.all([
      this.battery.read().catch((): BatterySnapshot => ({
        level: null,
        state: 'unknown',
        lowPowerMode: false,
      })),
      this.network.read().catch((): NetworkSnapshot => ({
        type: null,
        isInternetReachable: null,
      })),
    ]);

    this.batterySnapshot = battery;
    this.networkSnapshot = network;
  }

  private mergeBatteryReading(reading: BatteryReading): void {
    this.batterySnapshot = {
      level: reading.level !== undefined ? reading.level : (this.batterySnapshot?.level ?? null),
      state: reading.state ?? this.batterySnapshot?.state ?? 'unknown',
      lowPowerMode: reading.lowPowerMode ?? this.batterySnapshot?.lowPowerMode ?? false,
    };
  }

  private write(): void {
    if (!this.started) {
      return;
    }

    this.contextStore.set(
      toDeviceEnvironmentLogFields({
        battery: this.batterySnapshot,
        network: this.networkSnapshot,
      }),
    );
  }
}
