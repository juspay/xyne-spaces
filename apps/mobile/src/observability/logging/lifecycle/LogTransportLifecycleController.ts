import type { StartableLogTransport } from '../transports/LogTransport';
import type { AppLifecycle, AppLifecycleState, AppLifecycleSubscription } from './AppLifecycle';

export type LogTransportLifecycleControllerOptions = Readonly<{
  transport: StartableLogTransport;
  appLifecycle: AppLifecycle;
  onFlushError?: (error: unknown) => void;
}>;

export class LogTransportLifecycleController {
  private readonly transport: StartableLogTransport;
  private readonly appLifecycle: AppLifecycle;
  private readonly onFlushError: (error: unknown) => void;

  private subscription: AppLifecycleSubscription | null = null;
  private currentState: AppLifecycleState | null = null;

  constructor(options: LogTransportLifecycleControllerOptions) {
    this.transport = options.transport;
    this.appLifecycle = options.appLifecycle;
    this.onFlushError = options.onFlushError ?? ((): void => undefined);
  }

  start(): void {
    if (this.subscription !== null) {
      return;
    }

    const currentState = this.appLifecycle.currentState;

    this.currentState = currentState;

    this.subscription = this.appLifecycle.subscribe((nextState): void => {
      this.handleStateChange(nextState);
    });

    this.applyState(currentState);
  }

  stop(): void {
    const subscription = this.subscription;

    if (subscription === null) {
      return;
    }

    subscription.remove();

    this.subscription = null;
    this.currentState = null;

    this.transport.stop();
    this.requestFlush();
  }

  private handleStateChange(nextState: AppLifecycleState): void {
    if (nextState === this.currentState) {
      return;
    }

    this.currentState = nextState;
    this.applyState(nextState);
  }

  private applyState(state: AppLifecycleState): void {
    if (state === 'foreground') {
      this.transport.start();
      return;
    }

    this.transport.stop();
    this.requestFlush();
  }

  private requestFlush(): void {
    void this.transport.flush().catch((error: unknown) => {
      try {
        this.onFlushError(error);
      } catch {
        // A logging diagnostic must never crash the application
      }
    });
  }
}
