import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { InMemoryLogContextStore } from '../context/InMemoryLogContextStore';
import type { Battery, BatteryReading, BatterySnapshot, BatterySubscription } from './Battery';
import { DeviceEnvironmentController } from './DeviceEnvironmentController';
import type { Network, NetworkSnapshot, NetworkSubscription } from './Network';

class ManualBattery implements Battery {
  snapshot: BatterySnapshot = {
    level: 0.8,
    state: 'unplugged',
    lowPowerMode: false,
  };

  private readonly listeners = new Set<(reading: BatteryReading) => void>();

  async read(): Promise<BatterySnapshot> {
    return this.snapshot;
  }

  subscribe(listener: (reading: BatteryReading) => void): BatterySubscription {
    this.listeners.add(listener);

    return {
      remove: (): void => {
        this.listeners.delete(listener);
      },
    };
  }

  emit(reading: BatteryReading): void {
    for (const listener of this.listeners) {
      listener(reading);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

class ManualNetwork implements Network {
  snapshot: NetworkSnapshot = {
    type: 'WIFI',
    isInternetReachable: true,
  };

  private readonly listeners = new Set<(snapshot: NetworkSnapshot) => void>();

  async read(): Promise<NetworkSnapshot> {
    return this.snapshot;
  }

  subscribe(listener: (snapshot: NetworkSnapshot) => void): NetworkSubscription {
    this.listeners.add(listener);

    return {
      remove: (): void => {
        this.listeners.delete(listener);
      },
    };
  }

  emit(snapshot: NetworkSnapshot): void {
    this.snapshot = snapshot;

    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

describe('DeviceEnvironmentController', () => {
  it('writes battery and network context after start', async () => {
    const contextStore = new InMemoryLogContextStore();
    const battery = new ManualBattery();
    const network = new ManualNetwork();
    const controller = new DeviceEnvironmentController({
      battery,
      network,
      contextStore,
    });

    await controller.start();
    await controller.start();

    assert.equal(battery.listenerCount, 1);
    assert.deepEqual(contextStore.snapshot(), {
      batteryLevel: 80,
      batteryState: 'unplugged',
      lowPowerMode: false,
      networkType: 'wifi',
      isInternetReachable: true,
    });
  });

  it('updates context when sensors change and clears it on stop', async () => {
    const contextStore = new InMemoryLogContextStore();
    const battery = new ManualBattery();
    const network = new ManualNetwork();
    const controller = new DeviceEnvironmentController({
      battery,
      network,
      contextStore,
    });

    contextStore.set({
      userId: 'user-1',
    });

    await controller.start();

    battery.emit({
      level: 0.2,
      state: 'charging',
    });
    network.emit({
      type: 'CELLULAR',
      isInternetReachable: true,
    });

    assert.deepEqual(contextStore.snapshot(), {
      userId: 'user-1',
      batteryLevel: 20,
      batteryState: 'charging',
      lowPowerMode: false,
      networkType: 'cellular',
      isInternetReachable: true,
    });

    controller.stop();
    controller.stop();

    assert.equal(battery.listenerCount, 0);
    assert.equal(network.listenerCount, 0);
    assert.deepEqual(contextStore.snapshot(), {
      userId: 'user-1',
    });
  });
});
