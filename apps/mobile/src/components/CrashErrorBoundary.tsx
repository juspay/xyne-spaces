import React, { Component, ErrorInfo, ReactNode } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Platform } from 'react-native';
import { crashReporter } from '@/src/utils/crashReporter';
import { haptics } from '@/src/utils/haptics';
import { logger, Event } from '@/src/utils/logger';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKeys?: unknown[];
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class CrashErrorBoundary extends Component<Props, State> {
  private previousResetKeys: unknown[] = [];

  constructor(props: Props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return {
      hasError: true,
      error,
    };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    const boundaryName = this.props.name || 'CrashErrorBoundary';

    // Report to crash reporter
    crashReporter.reportComponentError(error);

    // Additional context logging
    logger.error(Event.LOTUS_ERROR_BOUNDARY_CAUGHT, {
      boundaryName,
      errorMessage: error.message,
      errorName: error.name,
      errorStack: error.stack,
      componentStack: errorInfo.componentStack,
    });

    this.setState({ errorInfo });

    void haptics.error();

    // Call optional callback
    this.props.onError?.(error, errorInfo);
  }

  override componentDidUpdate(): void {
    // Auto-reset when resetKeys change (useful with navigation)
    if (this.state.hasError && this.props.resetKeys) {
      const changed = this.props.resetKeys.some((key, idx) => key !== this.previousResetKeys[idx]);

      if (changed) {
        this.previousResetKeys = [...this.props.resetKeys];
        this.reset();
      }
    }
  }

  reset = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
    });
  };

  override render(): ReactNode {
    if (this.state.hasError) {
      // Custom fallback UI
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Production: Simple error screen
      if (!__DEV__) {
        return (
          <View style={styles.container}>
            <Text style={styles.emoji}>😵</Text>
            <Text style={styles.title}>Something went wrong</Text>
            <Text style={styles.message}>
              We&apos;ve logged this issue and our team will look into it.
            </Text>
            <TouchableOpacity onPress={this.reset} style={styles.button}>
              <Text style={styles.buttonText}>Try Again</Text>
            </TouchableOpacity>
          </View>
        );
      }

      // Development: Detailed error view
      return (
        <View style={styles.container}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <Text style={styles.devTitle}>⚠️ Error Boundary Caught</Text>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Error</Text>
              <Text style={styles.errorText}>{this.state.error?.toString()}</Text>
            </View>

            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Component Stack</Text>
              <Text style={styles.stackText}>{this.state.errorInfo?.componentStack}</Text>
            </View>

            {this.props.name && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Boundary</Text>
                <Text style={styles.metaText}>{this.props.name}</Text>
              </View>
            )}
          </ScrollView>

          <TouchableOpacity onPress={this.reset} style={[styles.button, styles.devButton]}>
            <Text style={styles.buttonText}>Dismiss & Retry</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

/**
 * Higher-order component for wrapping screens with error boundary.
 *
 * Usage:
 *   export default withErrorBoundary(MyScreen, { name: 'MyScreen' });
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  boundaryProps?: Omit<Props, 'children'>,
): React.FC<P> {
  const WrappedComponent: React.FC<P> = (props: P) => {
    return (
      <CrashErrorBoundary {...boundaryProps}>
        <Component {...props} />
      </CrashErrorBoundary>
    );
  };

  // Set display name for debugging
  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 100,
  },
  emoji: {
    fontSize: 64,
    textAlign: 'center',
    marginTop: 100,
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 12,
    color: '#1a1a1a',
  },
  message: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginHorizontal: 40,
    marginBottom: 32,
    lineHeight: 22,
  },
  devTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#e74c3c',
    marginBottom: 20,
  },
  section: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  errorText: {
    fontSize: 14,
    color: '#e74c3c',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#fdf2f2',
    padding: 12,
    borderRadius: 8,
  },
  stackText: {
    fontSize: 12,
    color: '#666',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
  },
  metaText: {
    fontSize: 14,
    color: '#666',
    backgroundColor: '#f5f5f5',
    padding: 12,
    borderRadius: 8,
  },
  button: {
    backgroundColor: '#007AFF',
    marginHorizontal: 20,
    marginBottom: 40,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 10,
    alignItems: 'center',
  },
  devButton: {
    backgroundColor: '#e74c3c',
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
