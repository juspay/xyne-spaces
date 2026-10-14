export type AppLifecycleState = 'foreground' | 'background';

export type AppLifecycleListener = (nextState: AppLifecycleState) => void;

export interface AppLifecycleSubscription {
  remove(): void;
}

export interface AppLifecycle {
  readonly currentState: AppLifecycleState;

  subscribe(listener: AppLifecycleListener): AppLifecycleSubscription;
}
