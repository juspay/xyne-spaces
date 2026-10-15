import * as ExpoNetwork from 'expo-network';

import type { Network, NetworkSnapshot, NetworkSubscription } from './Network';

function toNetworkSnapshot(state: ExpoNetwork.NetworkState): NetworkSnapshot {
  return {
    type: state.type ?? null,
    isInternetReachable: state.isInternetReachable ?? null,
  };
}

export class ReactNativeNetwork implements Network {
  async read(): Promise<NetworkSnapshot> {
    try {
      return toNetworkSnapshot(await ExpoNetwork.getNetworkStateAsync());
    } catch {
      return {
        type: null,
        isInternetReachable: null,
      };
    }
  }

  subscribe(listener: (snapshot: NetworkSnapshot) => void): NetworkSubscription {
    try {
      const subscription = ExpoNetwork.addNetworkStateListener(state => {
        listener(toNetworkSnapshot(state));
      });

      return {
        remove: (): void => {
          subscription.remove();
        },
      };
    } catch {
      return {
        remove: (): void => undefined,
      };
    }
  }
}
