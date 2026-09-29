import { Component, type ErrorInfo, type ReactElement, type ReactNode } from 'react';
import { Button } from '../../ui/Button';
import { clearLastCanvasIdIfMatches } from '../../../hooks/usePersistedCanvasPreferences';
import { logger, Event } from '../../../utils/logger';

/** Where the boundary sits, so the logs say which surface failed. */
export type CanvasRenderSurface =
  | 'canvas-editor'
  | 'collaborative-canvas-editor'
  | 'canvas-preview'
  | 'summary-canvas-preview';

export interface CanvasRenderBoundaryProps {
  children: ReactNode;
  surface: CanvasRenderSurface;
  /** The canvas being rendered. Changing it clears a previous error. */
  canvasId?: string | undefined;
  /**
   * Compact fallback for small embeds (chat bubbles, summary previews) where
   * the full-size message would not fit.
   */
  compact?: boolean;
}

interface CanvasRenderBoundaryState {
  error: Error | null;
  /** The canvas the error belongs to, so switching canvas resets the boundary. */
  failedCanvasId: string | undefined;
}

/**
 * Contains a canvas render failure to the canvas itself (XYNE-65102).
 *
 * BlockNote builds its ProseMirror document while React renders, and throws
 * on the first node the schema rejects. Without a boundary that error climbs
 * to the route boundary and replaces the whole app with "Something went
 * wrong", including the sidebar the user would use to go somewhere else.
 *
 * With this boundary:
 *   - only the canvas area shows an error; navigation keeps working,
 *   - the failing canvas is removed from "last opened", so "My Canvas" does
 *     not reopen it on every visit,
 *   - the error is logged with the canvas id and surface,
 *   - opening another canvas renders normally (state resets on canvas change),
 *   - "Try again" re-mounts the editor, which works once the content has
 *     been repaired or a transient error has passed.
 *
 * Content is repaired before it reaches the editor (see
 * `removeUnknownBlocks`), so this is the last line of defence for content
 * the sanitizer does not yet know how to fix.
 */
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
    // A different canvas gets a fresh editor instead of the previous error.
    if (state.error && props.canvasId !== state.failedCanvasId) {
      return { error: null, failedCanvasId: undefined };
    }
    return null;
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const { canvasId, surface } = this.props;
    this.setState({ failedCanvasId: canvasId });

    const clearedLastCanvas = canvasId ? clearLastCanvasIdIfMatches(canvasId) : false;

    logger.error(Event.CANVAS_RENDER_FAILED, {
      canvasId,
      surface,
      errorName: error.name,
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      clearedLastCanvas,
    });
  }

  private readonly handleRetry = (): void => {
    this.setState({ error: null, failedCanvasId: undefined });
  };

  override render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }
    return this.props.compact ? this.renderCompactFallback() : this.renderFallback();
  }

  private renderCompactFallback(): ReactElement {
    return (
      <div
        data-id='canvas-render-error'
        role='alert'
        className='rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground'
      >
        This canvas preview could not be displayed.
      </div>
    );
  }

  private renderFallback(): ReactElement {
    return (
      <div
        data-id='canvas-render-error'
        role='alert'
        className='flex h-full min-h-[240px] w-full items-center justify-center p-6'
      >
        <div className='flex max-w-md flex-col items-center space-y-3 text-center'>
          <p className='text-base font-semibold text-foreground'>This canvas could not be opened</p>
          <p className='text-sm text-muted-foreground'>
            Part of its content could not be displayed. The rest of the app still works, and
            other canvases are not affected.
          </p>
          <Button
            variant='outline'
            size='sm'
            onClick={this.handleRetry}
            data-track-category='Canvas'
            data-track-name='Canvas_Render_Error_Retry'
          >
            Try again
          </Button>
        </div>
      </div>
    );
  }
}
