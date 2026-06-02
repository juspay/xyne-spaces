import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error, errorInfo: null };
  }

  override componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("ErrorBoundary caught:", error, errorInfo);
    this.setState({ error, errorInfo });
  }

  override render() {
    if (this.state.error) {
      return (
        <div
          style={{
            padding: 24,
            fontFamily: "system-ui, sans-serif",
            background: "#fff",
            color: "#dc2626",
            minHeight: "100vh",
          }}
        >
          <h1 style={{ fontSize: 20, marginBottom: 12 }}>Something went wrong</h1>
          <pre
            style={{
              background: "#fef2f2",
              padding: 16,
              borderRadius: 8,
              overflow: "auto",
              fontSize: 13,
              lineHeight: 1.5,
              border: "1px solid #fecaca",
            }}
          >
            {this.state.error.toString()}
            {"\n"}
            {this.state.error.stack}
            {"\n\n--- Component Stack ---\n"}
            {this.state.errorInfo?.componentStack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}
