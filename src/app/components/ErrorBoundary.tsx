import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback: (reset: () => void) => ReactNode;
}

interface State {
  failed: boolean;
}

/** Last line of defence: a render error shows a recoverable message, never a white screen. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo) {
    // Local console only — there is no telemetry.
    console.error(error, info.componentStack);
  }

  override render() {
    if (this.state.failed) return this.props.fallback(() => this.setState({ failed: false }));
    return this.props.children;
  }
}
