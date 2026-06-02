import { Component, type ReactNode } from "react";
import {
  WarningCircleIcon,
  ArrowCounterClockwiseIcon,
} from "@phosphor-icons/react";
import { Button } from "./ui/Button";

/* ── ErrorBoundary ──────────────────────────────────────────────────────── */

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onReset?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error("ErrorBoundary caught error:", error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
    this.props.onReset?.();
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <ErrorFallback
          error={this.state.error}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

/* ── Fallback UI ────────────────────────────────────────────────────────── */

function ErrorFallback({
  error,
  onReset,
}: {
  error: Error | null;
  onReset: () => void;
}) {
  const isDev = import.meta.env.DEV;

  return (
    <div
      data-id="error-boundary-fallback"
      className="flex h-full flex-col items-center justify-center gap-4 p-8"
    >
      <WarningCircleIcon size={48} className="text-xyne-error" />
      <h2 className="text-xl font-semibold text-xyne-fg-primary">
        Something went wrong
      </h2>
      {isDev && error && (
        <p className="max-w-lg rounded-lg bg-xyne-surface-sunken p-3 text-[13px] text-xyne-fg-secondary">
          {error.message}
        </p>
      )}
      <Button
        variant="secondary"
        onClick={onReset}
        leadingIcon={<ArrowCounterClockwiseIcon size={14} />}
      >
        Try again
      </Button>
    </div>
  );
}
