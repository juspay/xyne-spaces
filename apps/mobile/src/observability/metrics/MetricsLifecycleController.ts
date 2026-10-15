import type {
  AppLifecycle,
  AppLifecycleState,
  AppLifecycleSubscription,
} from '../logging/lifecycle/AppLifecycle';
import type { MetricsService } from './MetricsService';

type ManagedMetricsService = Pick<MetricsService, 'start' | 'forceFlush' | 'shutdown'>;

export type MetricsLifecycleControllerOptions = Readonly<{
  service: ManagedMetricsService;
  appLifecycle: AppLifecycle;
  onError?: (error: unknown) => void;
}>;

export class MetricsLifecycleController {
  private readonly service: ManagedMetricsService;
  private readonly appLifecycle: AppLifecycle;
  private readonly onError: (error: unknown) => void;

  private subscription: AppLifecycleSubscription | null = null;
  private currentState: AppLifecycleState | null = null;

  constructor(options: MetricsLifecycleControllerOptions) {
    this.service = options.service;
    this.appLifecycle = options.appLifecycle;
    this.onError = options.onError ?? ((): void => undefined);
  }

  start(): void {
    if (this.subscription !== null) {
      return;
    }

    this.currentState = this.appLifecycle.currentState;

    this.service.start();

    this.subscription = this.appLifecycle.subscribe(nextState => {
      this.handleStateChange(nextState);
    });

    if (this.currentState === 'background') {
      this.requestFlush();
    }
  }

  stop(): void {
    const subscription = this.subscription;

    if (subscription === null) {
      return;
    }

    subscription.remove();

    this.subscription = null;
    this.currentState = null;

    this.requestShutdown();
  }

  private handleStateChange(nextState: AppLifecycleState): void {
    if (nextState === this.currentState) {
      return;
    }

    this.currentState = nextState;

    if (nextState === 'background') {
      this.requestFlush();
    }
  }

  private requestFlush(): void {
    void this.service.forceFlush().catch(error => {
      this.reportError(error);
    });
  }

  private requestShutdown(): void {
    void this.service.shutdown().catch(error => {
      this.reportError(error);
    });
  }

  private reportError(error: unknown): void {
    try {
      this.onError(error);
    } catch {
      // Lifecycle diagnostics must never crash product code.
    }
  }
}
