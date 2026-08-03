import { Component, ReactNode, ReactElement } from 'react';
import { isRouteErrorResponse, useRouteError } from 'react-router-dom';
import { logger, Event } from '../../utils/logger';
import NotFoundScreen from '../../routes/NotFoundScreen/NotFoundScreen';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

interface ErrorFallbackProps {
  error?: unknown;
  errorInfo?: React.ErrorInfo | null | undefined;
}

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message || error.toString();
  }
  if (typeof error === 'object' && error !== null) {
    return JSON.stringify(error, null, 2);
  }
  return String(error);
};

const ErrorUI = ({ error, errorInfo }: ErrorFallbackProps): ReactElement => {
  const isDevelopment =
    window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const handleBackToHome = (): void => {
    window.location.href = '/';
  };

  return (
    <div
      data-id='error-fallback'
      className='flex h-screen w-full items-center justify-center bg-background'
    >
      <div className='flex flex-col items-center text-center space-y-4 max-w-4xl px-4'>
        <div className='flex flex-col items-center space-y-4 select-none'>
          <img src='/svgs/icons/error.svg' alt='Error' className='w-40 h-36' draggable='false' />
          <div className='space-y-2'>
            <p className='text-xl font-semibold text-foreground'>Oops! Something went wrong</p>
            <p className='text-md text-muted-foreground'>
              We couldn&apos;t complete your request. Please try again
            </p>
          </div>
        </div>

        {isDevelopment && error !== null && error !== undefined && (
          <div className='w-full text-left'>
            <div className='bg-muted border border-border rounded-lg p-4 space-y-4'>
              <div>
                <p className='text-sm font-semibold text-foreground mb-2'>
                  {error instanceof Error ? 'Error Message:' : 'Error Details:'}
                </p>
                <pre className='text-xs text-red-600 bg-background p-3 rounded border border-red-200 overflow-x-auto'>
                  {formatError(error)}
                </pre>
              </div>
              {error instanceof Error && error.stack && (
                <div>
                  <p className='text-sm font-semibold text-foreground mb-2'>Stack Trace:</p>
                  <pre className='text-xs text-muted-foreground bg-background p-3 rounded border border-border overflow-x-auto max-h-64 overflow-y-auto'>
                    {error.stack}
                  </pre>
                </div>
              )}
              {errorInfo?.componentStack && (
                <div>
                  <p className='text-sm font-semibold text-foreground mb-2'>Component Stack:</p>
                  <pre className='text-xs text-muted-foreground bg-background p-3 rounded border border-border overflow-x-auto max-h-64 overflow-y-auto'>
                    {errorInfo.componentStack}
                  </pre>
                </div>
              )}
            </div>
          </div>
        )}

        <button
          onClick={handleBackToHome}
          className='flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors flex-shrink-0'
          data-track-category='ErrorBoundary'
          data-track-name='Back_To_Home'
        >
          Back to Home
        </button>
      </div>
    </div>
  );
};

export const ErrorFallback = ({ error, errorInfo }: ErrorFallbackProps): ReactElement => {
  return <ErrorUI error={error} errorInfo={errorInfo} />;
};

export const RouterErrorFallback = (): ReactElement => {
  const error = useRouteError();
  // A missing page isn't a crash — no stack trace, no "something went wrong".
  if (isRouteErrorResponse(error) && error.status === 404) {
    return <NotFoundScreen />;
  }
  return <ErrorUI error={error} errorInfo={null} />;
};
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error, errorInfo: null };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error(Event.FRONTEND_ERROR, {
      type: 'migrated_console_error',
      message: String('ErrorBoundary caught an error:'),
      error: error,
      context: [errorInfo],
    });
    //TODO : Add to report errors to sentry

    logger.error(Event.FRONTEND_ERROR, {
      type: 'react_error_boundary',
      error,
      message: error.message,
      errorName: error.name,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
    });

    this.setState(prevState => ({
      ...prevState,
      error,
      errorInfo,
    }));
  }

  override render(): ReactElement {
    if (this.state.hasError) {
      return <ErrorFallback error={this.state.error} errorInfo={this.state.errorInfo} />;
    }

    return <>{this.props.children}</>;
  }
}
