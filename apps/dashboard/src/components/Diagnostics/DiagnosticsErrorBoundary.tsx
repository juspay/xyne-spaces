import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger, Event } from '../../utils/logger';

interface Props {
  children: ReactNode;
  onReset?: () => void;
}

interface State {
  error: Error | null;
}

/**
 * Contains failures inside the diagnostics panel.
 *
 * A tool that exists to explain a problem must never become one, and this panel
 * renders persisted reports — data that can outlive the shape it was written
 * against. Without a boundary, one stale field takes down the whole app at the
 * moment someone was trying to find out why it was misbehaving.
 *
 * Deliberately offers to clear the stored reports: that is the state most
 * likely to be at fault, and it is the one thing a user can act on from here.
 */
export class DiagnosticsErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    // Reported through the app logger like any other frontend error. The
    // diagnostics tap it passes through only inspects Zero events, so this
    // cannot re-enter the code that just failed.
    logger.error(Event.FRONTEND_ERROR, {
      source: 'diagnostics_panel',
      message: error.message,
      componentStack: info.componentStack ?? '',
    });
  }

  private readonly reset = (): void => {
    this.props.onReset?.();
    this.setState({ error: null });
  };

  override render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div className='flex h-full flex-col items-start gap-3 overflow-auto border-l border-border bg-background p-5 text-foreground'>
        <div>
          <h2 className='text-sm font-semibold'>Diagnostics could not be displayed</h2>
          <p className='mt-1 text-xs leading-relaxed text-neutral-600 dark:text-neutral-300'>
            The panel failed while rendering. The rest of the app is unaffected. This is most often
            a saved report from an older version of the diagnostics.
          </p>
        </div>
        <pre className='max-w-full overflow-x-auto rounded-md border border-border px-2.5 py-1.5 font-mono text-[11px] text-neutral-600 dark:text-neutral-300'>
          {error.message}
        </pre>
        <button
          type='button'
          onClick={this.reset}
          data-track-category='Diagnostics'
          data-track-name='ResetAfterCrash'
          className='rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800'
        >
          Clear saved reports and retry
        </button>
      </div>
    );
  }
}
