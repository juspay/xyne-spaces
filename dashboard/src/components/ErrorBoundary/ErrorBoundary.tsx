import { Component, ReactNode, ReactElement } from 'react';
import { useRouteError } from 'react-router-dom';

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
      className='flex h-screen w-full items-center justify-center bg-white'
    >
      <div className='flex flex-col items-center text-center space-y-4 max-w-4xl px-4'>
        <div className='flex flex-col items-center space-y-4 select-none'>
          <img src='/svgs/icons/error.svg' alt='Error' className='w-40 h-36' draggable='false' />
          <div className='space-y-2'>
            <p className='text-xl font-semibold text-gray-800'>Oops! Something went wrong</p>
            <p className='text-md text-gray-500'>
              We couldn&apos;t complete your request. Please try again
            </p>
          </div>
        </div>

        {isDevelopment && error !== null && error !== undefined && (
          <div className='w-full text-left'>
            <div className='bg-gray-50 border border-gray-200 rounded-lg p-4 space-y-4'>
              <div>
                <p className='text-sm font-semibold text-gray-700 mb-2'>
                  {error instanceof Error ? 'Error Message:' : 'Error Details:'}
                </p>
                <pre className='text-xs text-red-600 bg-white p-3 rounded border border-red-200 overflow-x-auto'>
                  {formatError(error)}
                </pre>
              </div>
              {error instanceof Error && error.stack && (
                <div>
                  <p className='text-sm font-semibold text-gray-700 mb-2'>Stack Trace:</p>
                  <pre className='text-xs text-gray-600 bg-white p-3 rounded border border-gray-200 overflow-x-auto max-h-64 overflow-y-auto'>
                    {error.stack}
                  </pre>
                </div>
              )}
              {errorInfo?.componentStack && (
                <div>
                  <p className='text-sm font-semibold text-gray-700 mb-2'>Component Stack:</p>
                  <pre className='text-xs text-gray-600 bg-white p-3 rounded border border-gray-200 overflow-x-auto max-h-64 overflow-y-auto'>
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
    // eslint-disable-next-line no-console
    console.error('ErrorBoundary caught an error:', error, errorInfo);
    //TODO : Add to report errors to sentry

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
