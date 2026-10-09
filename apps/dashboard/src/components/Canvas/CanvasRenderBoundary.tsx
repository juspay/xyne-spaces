import { Component, type ErrorInfo, type ReactNode } from 'react';
import { logger } from '../../utils/logger';

interface CanvasRenderBoundaryProps {
  canvasId?: string | undefined;
  onError?: () => void;
  children: ReactNode;
}

interface CanvasRenderBoundaryState {
  hasError: boolean;
}

export class CanvasRenderBoundary extends Component<
  CanvasRenderBoundaryProps,
  CanvasRenderBoundaryState
> {
  public override state: CanvasRenderBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): CanvasRenderBoundaryState {
    return { hasError: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    logger.error('canvas_render_failed', {
      canvasId: this.props.canvasId,
      error,
      componentStack: info.componentStack,
    });
    this.props.onError?.();
  }

  public override componentDidUpdate(prevProps: CanvasRenderBoundaryProps): void {
    if (this.state.hasError && prevProps.canvasId !== this.props.canvasId) {
      this.setState({ hasError: false });
    }
  }

  public override render(): ReactNode {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className='flex h-full flex-col items-center justify-center gap-3 bg-muted p-6 text-center'>
        <h3 className='text-lg font-medium text-foreground'>This canvas could not be opened</h3>
        <p className='max-w-md text-sm text-muted-foreground'>
          Something in this canvas could not be displayed. You can pick another canvas from the
          list.
        </p>
        <button
          type='button'
          className='rounded-lg border border-border px-3 py-1.5 text-sm text-foreground hover:bg-accent'
          onClick={() => this.setState({ hasError: false })}
        >
          Try again
        </button>
      </div>
    );
  }
}
