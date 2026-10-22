import { AppState } from 'react-native';

import type {
  AppLifecycle,
  AppLifecycleListener,
  AppLifecycleState,
  AppLifecycleSubscription,
} from './AppLifecycle';
import { toAppLifecycleState } from './toAppLifecycleState';

export class ReactNativeAppLifecycle implements AppLifecycle {
  get currentState(): AppLifecycleState {
    return toAppLifecycleState(AppState.currentState);
  }

  subscribe(listener: AppLifecycleListener): AppLifecycleSubscription {
    const nativeSubscription = AppState.addEventListener('change', (nextState): void => {
      listener(toAppLifecycleState(nextState));
    });

    return {
      remove: (): void => {
        nativeSubscription.remove();
      },
    };
  }
}
