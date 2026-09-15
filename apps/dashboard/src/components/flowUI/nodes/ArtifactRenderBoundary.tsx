import { Component, type ErrorInfo, type ReactNode } from 'react';

interface ArtifactRenderBoundaryProps {
  children: ReactNode;
  fallbackText: string;
}

interface ArtifactRenderBoundaryState {
  failed: boolean;
}

export class ArtifactRenderBoundary extends Component<
  ArtifactRenderBoundaryProps,
  ArtifactRenderBoundaryState
> {
  public override state: ArtifactRenderBoundaryState = { failed: false };

  public static getDerivedStateFromError(): ArtifactRenderBoundaryState {
    return { failed: true };
  }

  public override componentDidCatch(error: Error, info: ErrorInfo): void {
    /* eslint-disable no-console */
    console.error('[flowUI] artifact failed to render', error, info.componentStack);
  }

  public override render(): ReactNode {
    if (this.state.failed) {
      return (
        <pre className='overflow-x-auto whitespace-pre-wrap p-4 font-mono text-xs text-muted-foreground'>
          {this.props.fallbackText}
        </pre>
      );
    }
    return this.props.children;
  }
}
