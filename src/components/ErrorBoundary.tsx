import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  info: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { error: null, info: null };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary]", error, info);
    this.setState({ error, info });
  }

  reset = () => this.setState({ error: null, info: null });

  reload = () => window.location.reload();

  override render() {
    if (!this.state.error) return this.props.children;
    const { error, info } = this.state;
    return (
      <div className="flex h-[100dvh] w-full items-start justify-center overflow-y-auto bg-zinc-950 p-6 text-zinc-100">
        <div className="w-full max-w-2xl space-y-4">
          <h1 className="text-xl font-semibold text-red-400">Something went wrong</h1>
          <div className="rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
            <div className="font-medium">{error.name}: {error.message}</div>
          </div>
          {error.stack && (
            <pre className="max-h-72 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-400 whitespace-pre-wrap">
              {error.stack}
            </pre>
          )}
          {info?.componentStack && (
            <pre className="max-h-48 overflow-auto rounded-lg border border-zinc-800 bg-zinc-900 p-3 text-xs text-zinc-500 whitespace-pre-wrap">
              {info.componentStack}
            </pre>
          )}
          <div className="flex gap-3">
            <button onClick={this.reset} className="rounded-lg bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700">
              Try Again
            </button>
            <button onClick={this.reload} className="rounded-lg bg-teal-600 px-4 py-2 text-sm hover:bg-teal-500">
              Reload Page
            </button>
          </div>
        </div>
      </div>
    );
  }
}
