import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { clearLastCanvasIdIfMatches } from '../../../hooks/usePersistedCanvasPreferences';
import { logger, Event } from '../../../utils/logger';

export interface CanvasRenderBoundaryProps {
  children: ReactNode;
  surface: string;
  canvasId?: string | undefined;
  compact?: boolean;
}

interface CanvasRenderBoundaryState {
  error: Error | null;
  failedCanvasId: string | undefined;
}

export class CanvasRenderBoundary extends Component<
  CanvasRenderBoundaryProps,
  CanvasRenderBoundaryState
> {
  override state: CanvasRenderBoundaryState = { error: null, failedCanvasId: undefined };

  static getDerivedStateFromError(error: unknown): Partial<CanvasRenderBoundaryState> {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  static getDerivedStateFromProps(
    props: CanvasRenderBoundaryProps,
    state: CanvasRenderBoundaryState,
  ): Partial<CanvasRenderBoundaryState> | null {
    if (state.error && props.canvasId !== state.failedCanvasId) {
      return { error: null, failedCanvasId: undefined };
    }
    return null;
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { canvasId, surface } = this.props;
    this.setState({ failedCanvasId: canvasId });
    if (canvasId) clearLastCanvasIdIfMatches(canvasId);
    logger.error(Event.CANVAS_RENDER_FAILED, {
      canvasId,
      surface,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
    });
  }

  override render(): ReactNode {
    if (!this.state.error) return this.props.children;

    if (this.props.compact) {
      return (
        <div
          data-id='canvas-render-error'
          className='rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground'
        >
          This canvas preview could not be displayed.
        </div>
      );
    }

    return (
      <div
        data-id='canvas-render-error'
        className='flex h-full min-h-[240px] w-full flex-col items-center justify-center space-y-3 p-6 text-center'
      >
        <p className='text-base font-semibold text-foreground'>This canvas could not be opened</p>
        <Button
          variant='outline'
          size='sm'
          onClick={() => this.setState({ error: null, failedCanvasId: undefined })}
          data-track-category='Canvas'
          data-track-name='Canvas_Render_Error_Retry'
        >
          Try again
        </Button>
      </div>
    );
  }
}
